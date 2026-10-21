import { installFloatingGestures } from "./helpers/floating-gestures.js";
import { chromium, webkit, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import * as THREE from "three";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { annotateFailure } from "./report.js";
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium",
  base = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
const world = new World({ bots: 0 });
world.obstacles = [];
world.obstacleGrid.clear();
world.random = () => 1;
// Progression/protection is covered by the HUD suite. This arena isolates touch
// targeting, even when a slow screenshot lets automatic shots run for longer.
world.gain = () => {};
while (world.orbs.active.length) world.orbs.release(0);
for (const [id, x, hp] of [
  ["chosen", 0, 1500],
  ["weak", 6, 1000],
])
  Object.assign(world.addPlayer(id, id), {
    x,
    z: 8,
    hp,
    maxHp: hp,
    spawnShield: 0,
  });
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
let actor;
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    actor = world.addPlayer(socket.id, data.name);
    Object.assign(actor, { x: 0, z: 0 });
    socket.emit("welcome", { id: actor.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (data) => world.setInput(socket.id, data));
  socket.on("upgrade", (key) => world.choose(socket.id, key));
  socket.on("latency", (cb) => cb());
  socket.on("disconnect", () => world.removePlayer(socket.id));
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const timer = setInterval(() => {
  world.step();
  for (const [id, socket] of io.sockets.sockets)
    socket.emit("state", world.snapshot(id));
}, 1000 / RULES.tick);
const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(engine === "chromium"
    ? {
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
      }
    : {}),
});
const errors = [];
mkdirSync("/tmp/archer-validation", { recursive: true });
try {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage();
  installFloatingGestures(page);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?server=http://127.0.0.1:${http.address().port}`);
  await expect(page.locator("#lobby")).toBeVisible();
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator("#play")).toBeVisible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.locator("#play").scrollIntoViewIfNeeded();
    const button = await page.locator("#play").boundingBox();
    assert.ok(
      button.y >= 0 && button.y + button.height <= height + 1,
      "play remains reachable on a short screen",
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#onehand-controls").tap();
  await expect(page.locator("#onehand-controls")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({
    path: `/tmp/archer-validation/new-lobby-${engine}-phone.png`,
  });
  await page.locator("#online-mode").tap();
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#aim-stick")).toBeHidden();
  await expect(page.locator("#auto-fire")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => actor?.autoTargetId).toBe("weak");
  // Project a real opponent with the same camera the scene uses; no app debug API.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 12;
        const next = () => {
          if (--frames === 0) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
  );
  const camera = new THREE.PerspectiveCamera(42, 390 / 844, 0.1, 180);
  camera.position.set(0, 32, 32 * 0.73);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const point = new THREE.Vector3(0, 1, 8).project(camera);
  await page.touchscreen.tap(
    ((point.x + 1) * 390) / 2,
    ((1 - point.y) * 844) / 2,
  );
  await expect.poll(() => actor.lockedTargetId).toBe("chosen");
  // setInput records the lock immediately; autoTarget is resolved by the next
  // 30 Hz world tick. Observe that outcome instead of racing the tick timer.
  await expect
    .poll(() => actor.autoTargetId, {
      message: "manual lock wins over the weaker opponent",
    })
    .toBe("chosen");
  await page.touchscreen.tap(190, 280);
  await expect.poll(() => actor.lockedTargetId).toBe(null);
  await expect.poll(() => actor.autoTargetId).toBe("weak");
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    const move = await page.locator("#move-stick").boundingBox();
    assert.ok(Math.abs(move.x + move.width / 2 - width / 2) < 1);
    const controls = [move];
    for (const id of ["dash", "heal", "auto-fire"]) {
      const r = await page.locator(`#${id}`).boundingBox();
      assert.ok(
        r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.width <= width + 1 &&
          r.y + r.height <= height + 1,
      );
      controls.push(r);
    }
    for (let i = 0; i < controls.length; i++)
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i],
          b = controls[j];
        assert.ok(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          "one-hand controls cannot overlap",
        );
      }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const stick = await page.locator("#move-stick").boundingBox(),
    before = actor.x;
  if (engine === "chromium") {
    const cd = await context.newCDPSession(page);
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          id: 1,
          x: stick.x + stick.width / 2 + 30,
          y: stick.y + stick.height / 2,
        },
      ],
    });
    await expect.poll(() => Math.abs(actor.x - before)).toBeGreaterThan(0.4);
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await page.mouse.move(
      stick.x + stick.width / 2 + 30,
      stick.y + stick.height / 2,
    );
    await page.mouse.down();
    await expect.poll(() => Math.abs(actor.x - before)).toBeGreaterThan(0.4);
    await page.mouse.up();
  }
  await page.screenshot({
    path: `/tmp/archer-validation/onehand-${engine}-phone.png`,
  });
  await page.locator("#leaders-toggle").tap();
  await page.locator("#exit").tap();
  await expect(page.locator("#lobby")).toBeVisible();
  await page.reload();
  await expect(page.locator("#onehand-controls")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#classic-controls").tap();
  await page.locator("#play").tap();
  await expect(page.locator("#aim-stick")).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    `LOBBY_ONEHAND_OK ${engine}: short/landscape menus, saved controls, centered joystick, automatic fire, real enemy tap lock/unlock, independent movement and classic fallback.`,
  );
} catch (error) {
  error.message += `\nEngine: ${engine}; actor: ${JSON.stringify(actor && { x: actor.x, z: actor.z, alive: actor.alive, level: actor.level, guard: actor.levelGuard, pending: actor.pending, target: actor.autoTargetId, locked: actor.lockedTargetId })}`;
  annotateFailure(error, "Lobby and one-handed controls");
  throw error;
} finally {
  clearInterval(timer);
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
}
