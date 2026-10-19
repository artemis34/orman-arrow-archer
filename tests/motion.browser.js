import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { annotateFailure } from "./report.js";

// Real browser controls + real authority, with ordered 130–210 ms RTT jitter.
// Delays apply to the network, never to the game's simulation or control logic.
const world = new World({ bots: 0 });
world.obstacles = [];
world.obstacleGrid.clear();
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
const pending = new Set();
let actor,
  shots = 0,
  received = [];
io.on("connection", (socket) => {
  let inputAt = 0,
    stateAt = 0,
    index = 0;
  const ordered = (direction, action) => {
    const at = Math.max(
      (direction === "input" ? inputAt : stateAt) + 1,
      Date.now() + 65 + [0, 40, 0, 15][index++ % 4],
    );
    if (direction === "input") inputAt = at;
    else stateAt = at;
    const timer = setTimeout(
      () => {
        pending.delete(timer);
        if (socket.connected) action();
      },
      Math.max(0, at - Date.now()),
    );
    pending.add(timer);
  };
  socket.on("join", (data) => {
    actor = world.addPlayer(socket.id, data.name);
    Object.assign(actor, { x: -10, z: -10 });
    socket.emit("welcome", { id: actor.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (input) =>
    ordered("input", () => {
      received.push(input);
      world.setInput(socket.id, input);
    }),
  );
  socket.on("latency", (callback) => ordered("state", callback));
  socket.on("disconnect", () => world.removePlayer(socket.id));
  socket.data.publish = (state) =>
    ordered("state", () => socket.emit("state", state));
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const tick = setInterval(() => {
  while (world.orbs.active.length) world.orbs.release(0);
  world.step();
  shots += world.events.filter((e) => e.type === "shot").length;
  for (const [id, socket] of io.sockets.sockets)
    if (world.players.has(id))
      socket.data.publish(structuredClone(world.snapshot(id)));
}, 1000 / RULES.tick);
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : chromium.executablePath()),
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage(),
    errors = [];
  await page.addInitScript(() => {
    window.__controlEvents = [];
    for (const type of [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ])
      document.addEventListener(
        type,
        (event) =>
          window.__controlEvents.push({
            type,
            id: event.pointerId,
            target: event.target.id,
            x: event.clientX,
            y: event.clientY,
          }),
        true,
      );
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.TEST_SERVER_URL || "http://127.0.0.1:3000");
  await page.locator("#online-mode").click();
  await page
    .locator("#server-url")
    .fill(`http://127.0.0.1:${http.address().port}`);
  await page.locator("#play").click();
  await expect(page.locator("#hud")).toBeVisible();
  await expect.poll(() => received.length).toBeGreaterThan(3);
  const cdp = await context.newCDPSession(page);
  const finger = async (selector, id, x, y) => {
    const box = await page.locator(selector).boundingBox();
    return { id, x: box.x + box.width / 2 + x, y: box.y + box.height / 2 + y };
  };
  const touch = (type, touchPoints) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const neutral = await finger("#move-stick", 1, 3, -3);
  let count = received.length;
  await touch("touchStart", [neutral]);
  await expect.poll(() => received.length).toBeGreaterThan(count + 4);
  assert.equal(actor.input.x, 0, "resting-thumb jitter is neutral");
  assert.equal(actor.input.z, 0);
  const move = await finger("#move-stick", 1, 32, 0);
  await touch("touchMove", [move]);
  await expect.poll(() => actor.input.x).toBeGreaterThan(0.7);
  const aim = await finger("#aim-stick", 2, 0, -30);
  await touch("touchStart", [move, aim]);
  await expect.poll(() => actor.charge).toBeGreaterThan(0.5);
  assert.ok(actor.input.x > 0.7, "aiming must not replace walking");
  // Perspective adds a small horizontal component while the camera follows.
  assert.ok(
    Math.abs(actor.angle + Math.PI / 2) < 0.15,
    "walking right cannot hijack upward aim",
  );
  mkdirSync("/tmp/archer-validation", { recursive: true });
  await page.screenshot({
    path: "/tmp/archer-validation/motion-two-fingers-portrait.png",
  });

  // Lift the walking finger only: aiming stays held, walking stops.
  await touch("touchEnd", [move]);
  await expect.poll(() => Math.hypot(actor.input.x, actor.input.z)).toBe(0);
  assert.equal(actor.input.charge, true);
  await touch("touchStart", [move, aim]);
  await expect.poll(() => actor.input.x).toBeGreaterThan(0.7);
  const beforeShot = shots;
  // Lift the aiming finger only: one arrow fires, walking stays held.
  await touch("touchEnd", [aim]);
  await expect.poll(() => shots).toBe(beforeShot + 1);
  assert.ok(actor.input.x > 0.7);
  assert.equal(actor.input.charge, false);

  // A native touch cancellation cancels the draw rather than firing it.
  await touch("touchStart", [move, aim]);
  await expect.poll(() => actor.charge).toBeGreaterThan(0.5);
  const beforeCancel = shots;
  await touch("touchCancel", []);
  await expect.poll(() => actor.charge).toBe(0);
  assert.equal(shots, beforeCancel);
  assert.equal(actor.input.x, 0);
  assert.ok(received.some((input) => input.cancelShot));

  // A new pair of fingers works after cancellation and after rotation.
  await page.setViewportSize({ width: 844, height: 390 });
  const moveWide = await finger("#move-stick", 3, -32, 0);
  const aimWide = await finger("#aim-stick", 4, 25, -25);
  await touch("touchStart", [moveWide, aimWide]);
  await expect.poll(() => actor.input.x).toBeLessThan(-0.7);
  await expect.poll(() => actor.charge).toBeGreaterThan(0.5);
  await page.screenshot({
    path: "/tmp/archer-validation/motion-two-fingers-landscape.png",
  });
  await touch("touchEnd", [aimWide]);
  await expect.poll(() => actor.input.charge).toBe(false);
  assert.ok(actor.input.x < -0.7);
  await touch("touchEnd", []);
  await expect.poll(() => actor.input.x).toBe(0);
  assert.deepEqual(errors, []);
  console.log(
    "MOTION_BROWSER_OK: real two-finger controls with 130–210ms RTT/jitter, neutral thumb, independent aim/movement, either release order, cancelled-shot safety, portrait/landscape and recovery.",
  );
} catch (error) {
  for (const page of browser
    ?.contexts()
    .flatMap((context) => context.pages()) || []) {
    console.error(
      "TOUCH_EVENTS",
      await page.evaluate(() => window.__controlEvents),
    );
    console.error("LAST_INPUTS", received.slice(-3));
    await page
      .screenshot({ path: "/tmp/archer-validation/motion-failure.png" })
      .catch(() => {});
  }
  annotateFailure(error, "Movement and simultaneous touch controls");
  throw error;
} finally {
  await browser?.close();
  clearInterval(tick);
  for (const timer of pending) clearTimeout(timer);
  await new Promise((resolve) => io.close(resolve));
}
