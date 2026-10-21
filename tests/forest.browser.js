import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { applyArrowImpact } from "../shared/skills.js";
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium",
  base = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
const world = new World({ bots: 0 });
world.obstacles = [];
world.obstacleGrid.clear();
while (world.orbs.active.length) world.orbs.release(0);
world.spawnOrb = () => {};
let progress = false;
const gain = world.gain.bind(world);
world.gain = (...args) => {
  if (progress) gain(...args);
};
const enemy = world.addPlayer("enemy", "Hedef");
Object.assign(enemy, { x: 12, z: -12, hp: 5000, maxHp: 5000, spawnShield: 0 });
const http = createServer(),
  io = new Server(http, { cors: { origin: true } }),
  queued = [];
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
  for (const [id, s] of io.sockets.sockets)
    s.emit("state", world.snapshot(id, [...queued, ...world.events]));
  queued.length = 0;
}, 1000 / 30);
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
mkdirSync("/tmp/archer-validation", { recursive: true });
try {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?server=http://127.0.0.1:${http.address().port}`);
  await page.locator("#online-mode").tap();
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible();
  let cd;
  if (engine === "chromium") {
    cd = await context.newCDPSession(page);
    const touch = (type, touchPoints) =>
      cd.send("Input.dispatchTouchEvent", { type, touchPoints });
    const left = { id: 1, x: 80, y: 420 },
      right = { id: 2, x: 295, y: 420 };
    await touch("touchStart", [left]);
    await expect(page.locator("#move-stick")).toHaveClass(/floating-origin/);
    let box = await page.locator("#move-stick").boundingBox();
    assert.ok(
      Math.abs(box.x + box.width / 2 - left.x) < 1 &&
        Math.abs(box.y + box.height / 2 - left.y) < 1,
    );
    assert.equal(
      Math.hypot(actor.input.x, actor.input.z),
      0,
      "touchdown defines the centre; movement begins on drag",
    );
    const moving = { ...left, x: left.x + 38 };
    await touch("touchMove", [moving]);
    await expect
      .poll(() => Math.hypot(actor.input.x, actor.input.z))
      .toBeGreaterThan(0.5);
    await touch("touchStart", [moving, right]);
    const aiming = { ...right, y: right.y - 38 };
    await touch("touchMove", [moving, aiming]);
    await expect.poll(() => actor.charge).toBeGreaterThan(0.3);
    assert.ok(
      Math.hypot(actor.input.x, actor.input.z) > 0.5,
      "two floating sticks remain independent",
    );
    box = await page.locator("#aim-stick").boundingBox();
    assert.ok(
      Math.abs(box.x + box.width / 2 - right.x) < 1 &&
        Math.abs(box.y + box.height / 2 - right.y) < 1,
    );
    await page.screenshot({
      path: `/tmp/archer-validation/forest-floating-${engine}.png`,
    });
    await touch("touchCancel", []);
    await expect.poll(() => actor.charge).toBe(0);
    await expect(page.locator("#move-stick")).not.toHaveClass(
      /floating-origin/,
    );
  } else {
    await page.touchscreen.tap(80, 420);
    assert.equal(
      await page
        .locator("#move-stick")
        .evaluate((e) => e.style.getPropertyValue("--floating-x")),
      "80px",
    );
  }
  await page.locator("#leaders-toggle").tap();
  await page.locator("#exit").tap();
  await page.locator("#onehand-controls").tap();
  await page.locator("#play").tap();
  await expect(page.locator("#aim-stick")).toBeHidden();
  if (cd) {
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 4, x: 145, y: 370 }],
    });
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 4, x: 180, y: 370 }],
    });
  } else {
    await page.mouse.move(145, 370);
    await page.mouse.down();
    await page.mouse.move(180, 370);
  }
  await expect
    .poll(() => Math.hypot(actor.input.x, actor.input.z))
    .toBeGreaterThan(0.5);
  assert.equal(actor.input.autoFire, true);
  if (cd)
    await cd.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
  else await page.mouse.up();
  progress = true;
  Object.assign(actor, {
    level: 1,
    xp: 0,
    pending: 0,
    choices: [],
    levelGuard: 0,
  });
  world.gain(actor, 55);
  await expect(page.locator(".word-level")).toHaveText("SEVİYE 2");
  await expect(page.locator(".word-level")).toBeVisible();
  if (actor.choices.length) world.choose(actor.id, actor.choices[0]);
  Object.assign(enemy, { hp: 1, alive: true, spawnShield: 0, hidden: false });
  world.combatRandom = () => 0;
  world.events = [];
  applyArrowImpact(
    world,
    {
      owner: actor.id,
      damage: 15,
      poison: 0,
      frost: false,
      blast: false,
      hits: new Set(),
    },
    enemy,
  );
  queued.push(...world.events);
  await expect(page.locator(".word-kill")).toHaveText("Kill");
  await expect(page.locator(".word-critical")).toHaveText("HeadShot");
  assert.equal(
    await page
      .locator(".word-critical")
      .evaluate((e) => getComputedStyle(e).color),
    "rgb(255, 81, 79)",
  );
  await page.screenshot({
    path: `/tmp/archer-validation/forest-feedback-${engine}.png`,
  });
  if (actor.choices.length) world.choose(actor.id, actor.choices[0]);
  Object.assign(actor, {
    levelGuard: 0,
    spawnShield: 0,
    input: { ...actor.input, autoFire: false },
  });
  const level = actor.level;
  world.loot.spawn(world);
  const drop = world.loot.drops.at(-1);
  Object.assign(drop, { x: actor.x, z: actor.z, landAt: world.time + 0.5 });
  await expect.poll(() => actor.level, { timeout: 8000 }).toBe(level + 1);
  await expect(page.locator("#toast")).toContainText("+1 seviye");
  assert.deepEqual(errors, []);
  console.log(
    `FOREST_BROWSER_OK ${engine}: floating origins, independent controls, one-handed fire, kill/critical/level labels and loot level-up`,
  );
} finally {
  clearInterval(timer);
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
}
