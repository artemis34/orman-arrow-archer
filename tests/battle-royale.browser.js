import { chromium, webkit, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { BattleRoyale } from "../shared/modes.js";
import { RULES } from "../shared/config.js";
import { annotateFailure } from "./report.js";
const base = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const w = new World({ bots: 0, mode: new BattleRoyale({ countdown: 0 }) });
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
const actors = [];
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    const p = w.addPlayer(socket.id, data.name, data.skin);
    if (!p) {
      socket.emit("full");
      return;
    }
    actors.push(p);
    socket.emit("welcome", {
      id: p.id,
      obstacles: w.obstacles,
      rules: RULES,
      format: "br",
    });
  });
  socket.on("input", (data) => w.setInput(socket.id, data));
  socket.on("upgrade", (key) => w.choose(socket.id, key));
  socket.on("rematch", () => w.mode.vote(w, socket.id));
  socket.on("respawn", () => w.respawn(socket.id));
  socket.on("latency", (cb) => cb());
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const fixture = `http://127.0.0.1:${http.address().port}`;
const timer = setInterval(() => {
  // No random XP during this deterministic browser scenario.
  while (w.orbs.active.length) w.orbs.release(0);
  w.step();
  for (const [id, socket] of io.sockets.sockets)
    socket.emit("state", w.snapshot(id));
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
mkdirSync("/tmp/archer-validation", { recursive: true });
const errors = [];
try {
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const desktop = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  for (const page of [mobile, desktop]) {
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/?format=br&server=${encodeURIComponent(fixture)}`);
    await expect(page.locator("#match-format")).toHaveValue("br");
    await page.locator("#online-mode").click();
    await page.locator("#play").click();
    await expect(page.locator("#hud")).toBeVisible();
  }
  await expect.poll(() => w.mode.phase).toBe("playing");
  const [a, b] = actors;
  Object.assign(a, { x: 0, z: 0, spawnShield: 0, levelGuard: 0 });
  Object.assign(b, { x: 35, z: 35, spawnShield: 0, levelGuard: 0 });
  w.time = w.mode.startedAt + 110;
  await expect(mobile.locator("#match-status")).toContainText("2 CANLI");
  await expect(desktop.locator("#match-status")).toHaveClass(/storm-warning/);
  await expect.poll(() => b.hp).toBeLessThan(b.maxHp);
  w.gain(a, 60);
  a.choices = ["multishot", "ricochet", "vitality"];
  await expect(mobile.locator("#upgrades")).toBeVisible();
  await expect(mobile.locator(".perk-value")).toHaveText([
    "+2 OK",
    "%40 HASAR",
    "+20 CAN",
  ]);
  await mobile.screenshot({
    path: `/tmp/archer-validation/br-${engine}-mobile-cards.png`,
  });
  await mobile.locator("#upgrade-options button").first().tap();
  await expect(mobile.locator("#upgrades")).toBeHidden();
  assert.equal(a.levelGuard, 0);
  // Camera and minimap now display a server-driven shrinking safe circle.
  await mobile.screenshot({
    path: `/tmp/archer-validation/br-${engine}-mobile-zone.png`,
  });
  b.kills = 10;
  b.matchPoints = 30;
  w.damage(b, 9999, null, "storm");
  assert.equal(w.respawn(b.id), false);
  await expect(mobile.locator("#round-results")).toBeVisible();
  await expect(mobile.locator("#round-winner")).toHaveText(`${a.name} kazandı`);
  assert.equal(w.mode.results[0].id, a.id);
  await expect(
    mobile.locator("#round-ranking .results-row").nth(1),
  ).toContainText("#1");
  await expect(desktop.locator("#death")).toBeHidden();
  await mobile.locator("#rematch").tap();
  await desktop.locator("#rematch").click();
  await expect.poll(() => w.mode.round).toBe(2);
  await expect(mobile.locator("#round-results")).toBeHidden();
  for (const p of actors) {
    assert.equal(p.alive, true);
    assert.equal(p.level, 1);
  }
  assert.deepEqual(errors, []);
  console.log(
    `BATTLE_ROYALE_BROWSER_OK ${engine}: two human clients, solo safe-zone damage, compact cards, early guard release, survivor wins over kills, no respawn and unanimous rematch.`,
  );
} catch (error) {
  annotateFailure(error, "Battle Royale browser");
  throw error;
} finally {
  clearInterval(timer);
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
}
