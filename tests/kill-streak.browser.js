import { selectControlMode } from "./helpers/control-mode.js";
import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";

const engine = process.env.PLAYWRIGHT_ENGINE || "chromium",
  base = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000",
  world = new World({ bots: 0 });
world.obstacles = [];
world.obstacleGrid.clear();
while (world.orbs.active.length) world.orbs.release(0);
world.spawnOrb = () => {};
world.gain = () => {};
const target = world.addPlayer("target", "Hedef");
Object.assign(target, { x: 12, z: 12, spawnShield: 0 });
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
let actor;
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    actor = world.addPlayer(socket.id, data.name);
    Object.assign(actor, { x: 0, z: 0, spawnShield: 0 });
    socket.emit("welcome", { id: actor.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (data) => world.setInput(socket.id, data));
  socket.on("upgrade", (key) => world.choose(socket.id, key));
  socket.on("latency", (cb) => cb());
  socket.on("respawn", () => world.respawn(socket.id));
  socket.on("disconnect", () => world.removePlayer(socket.id));
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const timer = setInterval(() => {
  world.step();
  for (const [id, socket] of io.sockets.sockets)
    socket.emit("state", world.snapshot(id));
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
function revive(p) {
  if (!p.alive) {
    world.time = Math.max(world.time, p.respawnAt + 0.1);
    world.respawn(p.id);
  }
  Object.assign(p, { spawnShield: 0, levelGuard: 0, hidden: false });
}
function frag() {
  revive(target);
  world.damage(target, 999, actor.id);
}
async function layout(page) {
  const badge = page.locator("#kill-streak");
  await badge.evaluate(async (el) => {
    await Promise.all(
      el.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  const a = await badge.boundingBox(),
    viewport = page.viewportSize();
  assert.ok(
    a.x >= 0 &&
      a.y >= 0 &&
      a.x + a.width <= viewport.width &&
      a.y + a.height <= viewport.height,
  );
  for (const selector of [
    "#move-stick",
    "#aim-stick",
    ".arena-vitals",
    ".arena-actions",
    ".arena-map",
  ]) {
    const other = page.locator(selector);
    if (!(await other.isVisible())) continue;
    const b = await other.boundingBox();
    assert.ok(
      a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y,
      `kill streak overlaps ${selector} on ${viewport.width}x${viewport.height}`,
    );
  }
  assert.equal(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, {
      x: a.x + a.width / 2,
      y: a.y + a.height / 2,
    }),
    "arena",
    "badge must not intercept gameplay touches",
  );
}
mkdirSync("/tmp/archer-validation", { recursive: true });
try {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/?server=http://127.0.0.1:${http.address().port}`);
  await page.locator("#online-mode").tap();
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible();
  const badge = page.locator("#kill-streak");
  await expect(badge).toBeHidden();
  frag();
  await expect.poll(() => actor.kills).toBe(1);
  await expect(badge).toBeHidden();
  frag();
  await expect(badge.locator("strong")).toHaveText("2");
  await expect(badge).toBeVisible();
  const heat = await badge.evaluate((el) =>
      Number(el.style.getPropertyValue("--streak-heat")),
    ),
    flame = await badge
      .locator("i")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).height));
  await layout(page);
  await page.screenshot({
    path: `/tmp/archer-validation/kill-streak-2-${engine}.png`,
  });
  for (let i = 0; i < 6; i++) frag();
  await expect(badge.locator("strong")).toHaveText("8");
  await expect(badge).toHaveAttribute(
    "aria-label",
    "Ölmeden 8 eleme. Kill streak.",
  );
  assert.ok(
    (await badge.evaluate((el) =>
      Number(el.style.getPropertyValue("--streak-heat")),
    )) > heat,
  );
  assert.ok(
    (await badge
      .locator("i")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).height))) > flame,
  );
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    await layout(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `/tmp/archer-validation/kill-streak-8-${engine}.png`,
  });
  revive(target);
  world.damage(actor, 999, target.id);
  await expect(badge).toBeHidden();
  assert.equal(actor.kills, 8);
  revive(actor);
  await expect
    .poll(
      () =>
        world.snapshot(actor.id).players.find((p) => p.id === actor.id)?.alive,
    )
    .toBe(true);
  await expect(badge).toBeHidden();
  frag();
  await expect(badge).toBeHidden();
  frag();
  await expect(badge.locator("strong")).toHaveText("2");
  await expect(badge).toBeVisible();
  assert.equal(actor.kills, 10, "life streak is separate from total kills");
  await page.locator("#leaders-toggle").tap();
  await page.locator("#exit").tap();
  await selectControlMode(page, "onehand");
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(badge).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  frag();
  frag();
  await expect(badge).toBeVisible();
  await expect(badge.locator("strong")).toHaveText("2");
  assert.equal(
    await badge
      .locator("i")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    await layout(page);
  }
  assert.deepEqual(errors, []);
  await context.close();
  const desktop = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    }),
    desktopPage = await desktop.newPage();
  await desktopPage.goto(
    `${base}/?server=http://127.0.0.1:${http.address().port}`,
  );
  await desktopPage.locator("#online-mode").click();
  await desktopPage.locator("#play").click();
  await expect(desktopPage.locator("#hud")).toBeVisible();
  frag();
  frag();
  await expect(desktopPage.locator("#kill-streak")).toBeVisible();
  await layout(desktopPage);
  console.log(
    `KILL_STREAK_BROWSER_OK ${engine}: confirmed kills, growing flame, death/respawn/menu resets, eight mobile layouts, desktop and reduced motion`,
  );
} finally {
  clearInterval(timer);
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
}
