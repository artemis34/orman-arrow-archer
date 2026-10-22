import { chromium, webkit, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RoundMode, FORMATS } from "../shared/modes.js";
import { RULES } from "../shared/config.js";
const base = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
let world;
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    world = new World({
      bots: 3,
      mode: new RoundMode(data.format, { duration: 3 }),
    });
    const p = world.addPlayer(socket.id, data.name, data.skin);
    socket.emit("welcome", {
      id: p.id,
      obstacles: world.obstacles,
      rules: RULES,
    });
  });
  socket.on("input", (data) => world?.setInput(socket.id, data));
  socket.on("rematch", () => world?.mode.vote(world, socket.id));
  socket.on("latency", (cb) => cb());
  socket.on("disconnect", () => {
    world?.removePlayer(socket.id);
  });
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const timer = setInterval(() => {
  if (!world) return;
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
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?server=http://127.0.0.1:${http.address().port}`);
  await expect(page.locator("#lobby")).toBeVisible();
  assert.equal(
    await page.locator("#match-format option").count(),
    Object.keys(FORMATS).length,
  );
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator("#collection-open").tap();
    await expect(page.locator("#collection")).toBeVisible();
    for (const tab of ["profile", "skills", "settings", "looks"]) {
      await page.locator(`[data-tab="${tab}"]`).tap();
      assert.ok(await page.locator(".collection-content").textContent());
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "no horizontal overflow",
    );
    const box = await page.locator(".collection-card").boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= width + 1 &&
        box.y + box.height <= height + 1,
    );
    await page.locator("#collection-close").tap();
    await page.locator("#play").scrollIntoViewIfNeeded();
    const play = await page.locator("#play").boundingBox();
    assert.ok(play.y >= 0 && play.y + play.height <= height + 1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#collection-open").tap();
  await page.screenshot({
    path: `/tmp/archer-validation/collection-${engine}-phone.png`,
  });
  await page.locator("#collection-close").tap();
  await page.locator("#match-format").selectOption("t2");
  await page.locator("#online-mode").tap();
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#match-status")).toContainText(/Kırmızı|Mavi/);
  await expect(page.locator("#leaders .arena-leader-row")).toHaveCount(2);
  await expect(page.locator("#leaders")).toContainText("Kırmızı");
  await expect(page.locator("#leaders")).toContainText("Mavi");
  await expect(page.locator("#round-results")).toBeVisible({ timeout: 12000 });
  assert.equal(await page.locator("#round-ranking .results-row").count(), 5);
  await expect(page.locator("#death")).toBeHidden();
  const round = world.mode.round;
  await page.screenshot({
    path: `/tmp/archer-validation/team-results-${engine}-phone.png`,
  });
  await page.locator("#rematch").tap();
  await expect.poll(() => world.mode.round, { timeout: 5000 }).toBe(round + 1);
  await expect(page.locator("#round-results")).toBeHidden();
  await expect(page.locator("#hud")).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    `EXPANSION_BROWSER_OK ${engine}: eight formats, compact collection at four sizes, profile/skills/settings, team score, timed results and immediate rematch.`,
  );
} finally {
  clearInterval(timer);
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
}
