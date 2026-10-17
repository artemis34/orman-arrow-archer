import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { annotateFailure } from "./report.js";
const baseUrl = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
// A real authority offers queued levels in a controlled arena, without exposing
// a debug world in the game or relying on random XP collected during a screenshot.
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
const world = new World({ bots: 0 });
while (world.orbs.active.length) world.orbs.release(0);
world.spawnOrb(15, 12, 60);
let id;
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    const p = world.addPlayer(socket.id, data.name, data.skin);
    id = p.id;
    Object.assign(p, { x: -2, z: 0 });
    world.gain(p, 200);
    p.hp = 35; // Keep health readable while choosing under pressure.
    socket.emit("welcome", {
      id: p.id,
      obstacles: world.obstacles,
      rules: RULES,
    });
  });
  socket.on("input", (data) => world.setInput(socket.id, data));
  socket.on("upgrade", (key) => world.choose(socket.id, key));
  socket.on("latency", (cb) => cb());
  socket.on("disconnect", () => world.removePlayer(socket.id));
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const fixtureUrl = `http://127.0.0.1:${http.address().port}`;
const timer = setInterval(() => {
  world.step();
  for (const [pid, socket] of io.sockets.sockets)
    socket.emit("state", world.snapshot(pid));
}, 1000 / 30);
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
const errors = [];
try {
  for (const [label, width, height, touch] of [
    ["desktop", 1440, 960, false],
    ["tablet", 1024, 1180, true],
    ["phone", 390, 844, true],
    ["small-phone", 375, 667, true],
    ["landscape", 844, 390, true],
  ]) {
    if (process.env.HUD_VIEW && process.env.HUD_VIEW !== label) continue;
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: touch,
      hasTouch: touch,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(baseUrl);
    await page.evaluate(() => {
      window.testTouches = [];
      for (const type of ["pointerdown", "pointerup", "pointercancel", "click"])
        document.addEventListener(
          type,
          (e) =>
            window.testTouches.push({
              type,
              id: e.pointerId,
              pointer: e.pointerType,
              target:
                e.target.closest("button")?.textContent.slice(0, 35) ||
                e.target.id,
              x: e.clientX,
              y: e.clientY,
            }),
          true,
        );
    });
    await page.locator("#online-mode").click();
    await page.locator("#server-url").fill(fixtureUrl);
    await page.locator("#play").click();
    await expect(page.locator("#upgrades")).toBeVisible();
    await expect(page.locator("#upgrade-options button")).toHaveCount(3);
    await expect(page.locator("#upgrade-count")).toContainText("2");
    const dock = await page.locator("#upgrades").boundingBox(),
      map = await page.locator(".arena-map").boundingBox(),
      leaders = await page.locator(".arena-corner").boundingBox();
    assert.ok(
      dock.y > height / 2,
      `${label}: cards must stay below the player`,
    );
    assert.ok(dock.height < height * 0.35, `${label}: cards must be compact`);
    assert.ok(
      map.x + map.width < leaders.x,
      `${label}: corner panels must stay apart`,
    );
    assert.equal(
      await page.evaluate(
        () => document.elementFromPoint(innerWidth / 2, innerHeight / 2).id,
      ),
      "arena",
      `${label}: arena center must remain playable`,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const before = world.players.get(id).x;
    if (touch) {
      const cd = await context.newCDPSession(page),
        stick = await page.locator("#move-stick").boundingBox();
      const move = {
        x: stick.x + stick.width / 2 + 22,
        y: stick.y + stick.height / 2,
        id: 1,
      };
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [move],
      });
      await expect
        .poll(() => world.players.get(id).x - before)
        .toBeGreaterThan(0.35);
      const card = await page
        .locator("#upgrade-options button")
        .first()
        .boundingBox();
      // CDP touchEnd lists the finger to lift. The movement finger stays down.
      const selection = {
        x: card.x + card.width / 2,
        y: card.y + card.height / 2,
        id: 2,
      };
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [move, selection],
      });
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [selection],
      });
      await expect.poll(() => world.players.get(id).pending).toBe(1);
      const after = world.players.get(id).x;
      await expect
        .poll(() => world.players.get(id).x - after)
        .toBeGreaterThan(0.2);
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await page.keyboard.down("KeyD");
      await expect
        .poll(() => world.players.get(id).x - before)
        .toBeGreaterThan(0.35);
      await page.locator("#upgrade-options button").first().click();
      await page.keyboard.up("KeyD");
      await expect.poll(() => world.players.get(id).pending).toBe(1);
      await page.mouse.move(width / 2 + 150, height / 2);
      await page.mouse.down();
      await expect
        .poll(() => world.players.get(id).charge)
        .toBeGreaterThan(0.1);
      await page.mouse.up();
    }
    await expect(page.locator("#upgrades")).toBeVisible();
    await page.locator("#upgrades-collapse")[touch ? "tap" : "click"]();
    await expect(page.locator("#upgrades")).toBeHidden();
    await expect(page.locator("#upgrade-reminder")).toBeVisible();
    await page.locator("#upgrade-reminder")[touch ? "tap" : "click"]();
    await expect(page.locator("#upgrades")).toBeVisible();
    await page.screenshot({
      path: `/tmp/archer-validation/cards-${label}.png`,
    });
    await page
      .locator("#upgrade-options button")
      .first()
      [touch ? "tap" : "click"]();
    await expect(page.locator("#upgrades")).toBeHidden();
    await expect(page.locator("#upgrade-reminder")).toBeHidden();
    await context.close();
    console.log(
      `HUD_OK ${label}: compact cards, movement while choosing, queued picks, collapse/reopen, clear arena.`,
    );
  }
  assert.deepEqual(errors, []);
} catch (error) {
  for (const [i, page] of browser
    .contexts()
    .flatMap((c) => c.pages())
    .entries()) {
    console.log(
      "TOUCH_DIAGNOSTICS",
      await page.evaluate(() => window.testTouches?.slice(-12)),
    );
    await page
      .screenshot({ path: `/tmp/archer-validation/hud-failure-${i}.png` })
      .catch(() => {});
  }
  annotateFailure(error, "Compact HUD and upgrade controls");
  throw error;
} finally {
  await browser.close();
  clearInterval(timer);
  await new Promise((resolve) => io.close(resolve));
}
