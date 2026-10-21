import { installFloatingGestures } from "./helpers/floating-gestures.js";
import { chromium, webkit, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { annotateFailure } from "./report.js";

const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const world = new World({ bots: 0 });
world.obstacles = [];
world.obstacleGrid.clear();
let actor,
  shots = 0;
const target = world.addPlayer("target", "Hedef", 1);
Object.assign(target, { x: 8, z: 0, hp: 200, maxHp: 200, spawnShield: 0 });
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    actor = world.addPlayer(socket.id, data.name, 0);
    Object.assign(actor, { x: 0, z: 0, spawnShield: 0 });
    socket.emit("welcome", { id: actor.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (input) => world.setInput(socket.id, input));
  socket.on("upgrade", (key) => world.choose(socket.id, key));
  socket.on("respawn", () => world.respawn(socket.id));
  socket.on("latency", (cb) => cb());
  socket.on("disconnect", () => world.removePlayer(socket.id));
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const timer = setInterval(() => {
  // Keep these interaction regressions independent of random levelling.
  while (world.orbs.active.length) world.orbs.release(0);
  world.step();
  shots += world.events.filter(
    (e) => e.type === "shot" && e.owner === actor?.id,
  ).length;
  for (const [id, socket] of io.sockets.sockets)
    socket.emit("state", world.snapshot(id));
}, 1000 / RULES.tick);
const launchOptions = {
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
};
let browser;
try {
  browser = await (engine === "webkit" ? webkit : chromium).launch(
    launchOptions,
  );
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  installFloatingGestures(page);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.TEST_SERVER_URL || "http://127.0.0.1:3000");
  await page.locator("#online-mode").click();
  await page
    .locator("#server-url")
    .fill(`http://127.0.0.1:${http.address().port}`);
  await page.locator("#play").click();
  await expect(page.locator("#hud")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#auto-fire")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  assert.equal(
    await page.locator("#arena").evaluate((canvas) => {
      const gl = canvas.getContext("webgl2");
      return !!gl && !gl.isContextLost() && gl.drawingBufferWidth > 0;
    }),
    true,
  );
  const map = await page.locator("#map-toggle").boundingBox();
  await page.locator("#map-toggle").tap();
  await expect(page.locator("#map-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  assert.ok(
    (await page.locator("#map-toggle").boundingBox()).width > map.width * 1.9,
  );
  await page.locator("#map-toggle").tap();
  await page.locator("#aim-stick").tap();
  await expect.poll(() => shots).toBe(1);
  await expect.poll(() => target.hp).toBeLessThan(200);
  world.gain(actor, 60);
  await expect(page.locator("#upgrades")).toBeVisible();
  assert.ok(actor.levelGuard > 0);
  await page.locator("#upgrade-options button").first().tap();
  await expect(page.locator("#upgrades")).toBeHidden();
  assert.equal(actor.levelGuard, 0);

  // The shortest supported phone landscape must leave the character unobscured.
  await page.setViewportSize({ width: 568, height: 320 });
  world.gain(actor, actor.level * 55 - actor.xp);
  await expect(page.locator("#upgrades")).toBeVisible();
  const dock = await page.locator("#upgrades").boundingBox();
  assert.ok(
    dock.width >= 300,
    "short landscape cards keep readable descriptions",
  );
  assert.ok(
    dock.y + dock.height < 160,
    "short landscape leaves the character and bottom controls clear",
  );
  await page.screenshot({
    path: `/tmp/archer-validation/interaction-${engine}-landscape.png`,
  });
  await page.locator("#upgrade-options button").first().tap();
  await expect(page.locator("#upgrades")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });

  // Automatic mode works in Chromium and WebKit through the real authority.
  const autoShots = shots;
  await page.locator("#auto-fire").tap();
  await expect(page.locator("#auto-fire")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => shots - autoShots, { timeout: 6500 })
    .toBeGreaterThanOrEqual(2);
  await page.locator("#auto-fire").tap();
  await expect.poll(() => actor.input.autoFire).toBe(false);

  let cdp, move;
  const release = () =>
    cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const hold = async () => {
    const box = await page.locator("#move-stick").boundingBox();
    move = { id: 1, x: box.x + box.width / 2 + 20, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [move],
    });
  };
  const press = async (selector) => {
    if (!cdp) return page.locator(selector).tap();
    const box = await page.locator(selector).boundingBox();
    const finger = {
      id: 2,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [move, finger],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [finger],
    });
  };
  if (engine === "chromium") {
    cdp = await page.context().newCDPSession(page);
    const before = actor.x;
    await hold();
    await expect.poll(() => actor.x - before).toBeGreaterThan(0.3);
  }
  world.damage(actor, 999);
  await expect(page.locator("#death")).toBeVisible();
  await expect(page.locator("#respawn")).toBeEnabled({ timeout: 6500 });
  await press("#respawn");
  await expect(page.locator("#death")).toBeHidden();
  assert.ok(actor.alive);
  assert.equal(actor.maxHp, 150);
  if (cdp) {
    await release();
    await hold();
  }
  await press("#leaders-toggle");
  await expect(page.locator("#leader-panel")).toBeVisible();
  const sound = page.locator("#leader-panel .sound-button");
  const enabled = await sound.getAttribute("aria-pressed");
  await press("#leader-panel .sound-button");
  await expect(sound).toHaveAttribute(
    "aria-pressed",
    enabled === "true" ? "false" : "true",
  );
  await press("#leader-panel .sound-button");
  await expect(sound).toHaveAttribute("aria-pressed", enabled);
  await press("#exit");
  await expect(page.locator("#lobby")).toBeVisible();
  if (cdp) await release();
  assert.deepEqual(errors, []);
  console.log(
    `INTERACTION_OK ${engine}: WebGL, map, auto shot, early level selection, 568x320 readable cards, death/respawn, sound, exit${cdp ? " while a real joystick touch remains held" : " with mobile touch input"}.`,
  );
} catch (error) {
  for (const page of browser
    ?.contexts()
    .flatMap((context) => context.pages()) || [])
    await page
      .screenshot({
        path: `/tmp/archer-validation/interaction-${engine}-failure.png`,
      })
      .catch(() => {});
  annotateFailure(error, `${engine} interaction regression`);
  throw error;
} finally {
  await browser?.close();
  clearInterval(timer);
  await new Promise((resolve) => io.close(resolve));
}
