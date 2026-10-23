import { selectControlMode } from "./helpers/control-mode.js";
import { installFloatingGestures } from "./helpers/floating-gestures.js";
import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { pauseStaleInput } from "../shared/online.js";
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
  frozenDraw = false,
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
    socket.data.lastInputAt = Date.now();
    socket.emit("welcome", { id: actor.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (input) =>
    ordered("input", () => {
      received.push(input);
      socket.data.lastInputAt = Date.now();
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
  for (const [id, socket] of io.sockets.sockets) {
    const p = world.players.get(id);
    if (p) {
      pauseStaleInput(p, Date.now() - socket.data.lastInputAt);
      if (p.inputStale && p.charge > 0) frozenDraw = true;
    }
  }
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
  installFloatingGestures(page);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.TEST_SERVER_URL || "http://127.0.0.1:3000");
  await selectControlMode(page, "classic");
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
  // Reproduce the 465 ms input gap seen on the public Cloudflare browser run.
  // A busy renderer can block JS timers even when input uses its own timer.
  await page.evaluate(() => {
    const end = performance.now() + 600;
    while (performance.now() < end) {}
  });
  assert.ok(
    frozenDraw,
    "the real authority must observe and freeze a stalled draw",
  );
  assert.equal(shots, beforeShot, "the stall itself cannot fire the bow");
  // Lift the aiming finger only: one arrow fires, walking stays held.
  await touch("touchEnd", [aim]);
  await expect.poll(() => shots).toBe(beforeShot + 1);
  assert.ok(actor.input.x > 0.7);
  assert.equal(actor.input.charge, false);
  await expect
    .poll(() =>
      Math.abs(actor.input.angle - Math.atan2(actor.input.z, actor.input.x)),
    )
    .toBeLessThan(0.01);

  // A native touch cancellation cancels the draw rather than firing it.
  await touch("touchStart", [move, aim]);
  await expect.poll(() => actor.charge).toBeGreaterThan(0.5);
  const beforeCancel = shots;
  await touch("touchCancel", []);
  await expect.poll(() => actor.charge).toBe(0);
  assert.equal(shots, beforeCancel);
  assert.equal(actor.input.x, 0);
  assert.ok(received.some((input) => input.cancelShot));

  // An inactive page must still send its cancellation edge, never release a
  // charged manual arrow while stopping automatic fire and movement.
  await touch("touchStart", [aim]);
  await expect.poll(() => actor.charge).toBeGreaterThan(0.3);
  const beforeBlur = shots;
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(() => actor.charge).toBe(0);
  assert.equal(shots, beforeBlur);
  await touch("touchCancel", []);
  const freshAim = await finger("#aim-stick", 9, 0, -30);
  await touch("touchStart", [freshAim]);
  await expect.poll(() => actor.charge).toBeGreaterThan(0.2);
  await touch("touchCancel", []);
  await expect.poll(() => actor.charge).toBe(0);

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

  // A single right-stick tap used to permanently lock the torso's direction.
  await page.setViewportSize({ width: 390, height: 844 });
  const walkDown = await finger("#move-stick", 5, 0, 32);
  const tapAim = await finger("#aim-stick", 6, 0, 0);
  await touch("touchStart", [walkDown]);
  await touch("touchStart", [walkDown, tapAim]);
  await touch("touchEnd", [tapAim]);
  await expect.poll(() => actor.input.z).toBeGreaterThan(0.7);
  await expect
    .poll(() =>
      Math.abs(actor.input.angle - Math.atan2(actor.input.z, actor.input.x)),
    )
    .toBeLessThan(0.01);
  await touch("touchEnd", []);

  // One finger alone walks while automatic mode repeats normal, server-owned
  // shots. A stationary target supplies deterministic aim and line of sight.
  Object.assign(actor, { x: -8, z: -6, shotCd: 0 });
  const target = world.addPlayer("onehand-target", "Hedef", 1);
  Object.assign(target, { x: -8, z: 6, spawnShield: 0, hp: 900, maxHp: 900 });
  await page.locator("#auto-fire").tap();
  await expect(page.locator("#auto-fire")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => actor.input.autoFire).toBe(true);
  const autoShots = shots;
  const walk = await finger("#move-stick", 7, 28, 0);
  const startX = actor.x;
  await touch("touchStart", [walk]);
  await expect.poll(() => actor.x - startX).toBeGreaterThan(0.5);
  await expect
    .poll(() => shots - autoShots, { timeout: 6500 })
    .toBeGreaterThanOrEqual(2);
  assert.ok(actor.input.x > 0.5);
  assert.ok(target.hp < 900, "one-handed shots must actually reach the enemy");
  await page.screenshot({
    path: "/tmp/archer-validation/onehand-auto-fire.png",
  });
  const toggle = await finger("#auto-fire", 8, 0, 0);
  await touch("touchStart", [walk, toggle]);
  await touch("touchEnd", [toggle]);
  await expect(page.locator("#auto-fire")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect.poll(() => actor.input.autoFire).toBe(false);
  const stoppedShots = shots;
  const stoppedX = actor.x;
  await expect.poll(() => actor.x - stoppedX).toBeGreaterThan(0.8);
  assert.equal(shots, stoppedShots, "turning off fire preserves held movement");
  await touch("touchEnd", []);
  await expect.poll(() => actor.input.x).toBe(0);

  // Focus loss immediately disables automatic fire; returning permits it again.
  await page.locator("#auto-fire").tap();
  await expect.poll(() => actor.input.autoFire).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(() => actor.input.autoFire).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => actor.input.autoFire).toBe(true);
  await page.locator("#auto-fire").tap();
  await expect.poll(() => actor.input.autoFire).toBe(false);
  assert.deepEqual(errors, []);
  console.log(
    "MOTION_BROWSER_OK: real two-finger controls with 130–210ms RTT/jitter, a 600ms renderer stall, neutral thumb, independent aim/movement, release and quick-tap torso recovery, cancelled-shot safety, portrait/landscape, one-handed automatic shots, held-stick toggle and focus suspension.",
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
