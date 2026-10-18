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
const victim = world.addPlayer("victim", "Zehir hedefi", 1);
Object.assign(victim, { x: 4, z: 0, spawnShield: 0, hp: 200, maxHp: 200 });
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    const p = world.addPlayer(socket.id, data.name, 0);
    Object.assign(p, { x: 0, z: 0, spawnShield: 0, upgrades: { poison: 3 } });
    socket.emit("welcome", { id: p.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (data) => world.setInput(socket.id, data));
  socket.on("latency", (cb) => cb());
  socket.on("disconnect", () => world.removePlayer(socket.id));
});
await new Promise((r) => http.listen(0, "127.0.0.1", r));
const timer = setInterval(() => {
  world.step();
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
    "--autoplay-policy=no-user-gesture-required",
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
  // Count real Web Audio voices without replacing audio synthesis or exposing
  // a debug API in the application. A poison tick must not start an oscillator.
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    window.__audioProbe = { starts: 0, ends: 0 };
    window.AudioContext = class extends Native {
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => {
          window.__audioProbe.starts++;
          return start(...args);
        };
        oscillator.addEventListener("ended", () => window.__audioProbe.ends++);
        return oscillator;
      }
    };
  });
  await page.goto(process.env.TEST_SERVER_URL || "http://127.0.0.1:3000");
  await page.locator("#online-mode").click();
  await page
    .locator("#server-url")
    .fill(`http://127.0.0.1:${http.address().port}`);
  await page.locator("#play").click();
  await expect(page.locator("#hud")).toBeVisible();
  await page.locator("#aim-stick").tap();
  await expect.poll(() => victim.poison).toBeGreaterThan(0);
  await expect.poll(() => victim.poison, { timeout: 4500 }).toBeLessThan(0.04);
  await expect
    .poll(() => page.evaluate(() => window.__audioProbe.ends))
    .toBe(2);
  assert.deepEqual(
    await page.evaluate(() => window.__audioProbe),
    { starts: 2, ends: 2 },
    "one shot and one impact; three seconds of poison add zero sounds",
  );
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "/tmp/archer-validation/poison-audio-phone.png",
  });
  console.log(
    "AUDIO_OK: real poison shot, one shot + one impact voice, no repeated DOT voices, both nodes ended.",
  );
} catch (error) {
  annotateFailure(error, "Poison audio regression");
  throw error;
} finally {
  await browser.close();
  clearInterval(timer);
  await new Promise((r) => io.close(r));
}
