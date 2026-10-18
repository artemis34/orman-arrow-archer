import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { annotateFailure } from "./report.js";
const world = new World({ bots: 0 });
world.obstacles = [];
world.obstacleGrid.clear();
while (world.orbs.active.length) world.orbs.release(0);
Object.assign(world.powerups.sites[0], { x: 0, z: 3 });
Object.assign(world.powerups.sites[1], { x: 0, z: -3 });
let actor;
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    actor = world.addPlayer(socket.id, data.name, 0);
    Object.assign(actor, { x: 0, z: 0, spawnShield: 0 });
    socket.emit("welcome", { id: actor.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (data) => world.setInput(socket.id, data));
  socket.on("upgrade", (key) => world.choose(socket.id, key));
  socket.on("latency", (cb) => cb());
  socket.on("disconnect", () => world.removePlayer(socket.id));
});
await new Promise((r) => http.listen(0, "127.0.0.1", r));
const timer = setInterval(() => {
  world.step();
  // Keep random XP spawns from introducing a level-up into this pickup test.
  while (world.orbs.active.length) world.orbs.release(0);
  for (const [id, socket] of io.sockets.sockets)
    socket.emit("state", world.snapshot(id));
}, 1000 / RULES.tick);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium")
      ? "/usr/bin/chromium"
      : chromium.executablePath()),
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.TEST_SERVER_URL || "http://127.0.0.1:3000");
  await page.locator("#online-mode").click();
  await page
    .locator("#server-url")
    .fill(`http://127.0.0.1:${http.address().port}`);
  await page.locator("#play").click();
  await expect(page.locator("#hud")).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  async function walk(direction) {
    const box = await page.locator("#move-stick").boundingBox();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          id: 1,
          x: box.x + box.width / 2,
          y: box.y + box.height / 2 + 30 * direction,
        },
      ],
    });
  }
  const release = () =>
    cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await walk(1);
  await expect.poll(() => actor.buffType).toBe("haste");
  await release();
  await expect(page.locator("#buff-status")).toContainText("ϟ");
  await expect(page.locator("#buff-status")).toHaveAttribute("title", /30/);
  assert.ok(actor.buffTime > 0 && actor.buffTime <= 15);
  assert.ok(world.powerups.sites[0].cooldown > 0);
  const old = actor.z;
  await walk(1);
  await expect.poll(() => actor.z - old).toBeGreaterThan(0.4);
  await release();
  assert.equal(
    actor.levelGuard,
    0,
    "collecting a powerup must not freeze play",
  );
  await page.screenshot({
    path: "/tmp/archer-validation/buff-haste-phone.png",
  });
  // Advance authority timers without exposing application debug state.
  world.powerups.tick(15, world.players.values());
  await expect(page.locator("#buff-status")).toBeHidden();
  Object.assign(actor, { x: 0, z: -1 });
  await page.waitForTimeout(120);
  await walk(-1);
  await expect.poll(() => actor.buffType).toBe("power");
  await release();
  await expect(page.locator("#buff-status")).toContainText("↑");
  await expect(page.locator("#buff-status")).toHaveAttribute("title", /20/);
  const clear = await page.evaluate(() => {
    const badge = document
      .getElementById("buff-status")
      .getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents(document.getElementById("health-text"));
    return badge.right < text.getBoundingClientRect().left;
  });
  assert.ok(clear, "buff countdown must leave health text readable");
  await page.locator("#map-toggle").tap();
  await expect(page.locator(".map-caption")).toContainText("HIZ");
  await page.screenshot({
    path: "/tmp/archer-validation/buff-power-map-phone.png",
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#buff-status")).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "/tmp/archer-validation/buff-power-landscape.png",
  });
  world.damage(actor, 999);
  await expect(page.locator("#buff-status")).toBeHidden();
  assert.equal(actor.buffTime, 0);
  assert.deepEqual(errors, []);
  console.log(
    "POWERUPS_OK: touch movement collected both public buffs, no freeze, expiry, cooldowns, compact phone/landscape HUD and death cleanup.",
  );
} catch (error) {
  annotateFailure(error, "Timed powerup touch controls");
  throw error;
} finally {
  await browser.close();
  clearInterval(timer);
  await new Promise((r) => io.close(r));
}
