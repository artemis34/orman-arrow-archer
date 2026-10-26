import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { createMode, FORMATS } from "../shared/modes.js";
import { populationFor } from "../shared/online.js";
import { RULES } from "../shared/config.js";
import { selectControlMode } from "./helpers/control-mode.js";
import { annotateFailure } from "./report.js";
const base = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const http = createServer(),
  io = new Server(http, { cors: { origin: true } }),
  rooms = new Map();
let latest;
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    const world = new World({ bots: 0, mode: createMode(data.format) });
    world.obstacles = [];
    world.obstacleGrid.clear();
    while (world.orbs.active.length) world.orbs.release(0);
    world.botInput = () => {};
    if (world.mode.rules?.battleRoyale) world.mode.countdown = 0;
    const p = world.addPlayer(socket.id, data.name, data.skin);
    const population = world.mode.rules?.duel ? 2 : populationFor(data.format);
    for (let i = 1; i < population; i++)
      world.addPlayer("fixture-" + i, "Target " + i, i % 4, true);
    world.step();
    Object.assign(p, { x: 0, z: 0, spawnShield: 0, levelGuard: 0 });
    let enemy = false,
      index = 0;
    for (const other of world.players.values())
      if (other !== p) {
        const opponent = p.team == null || p.team !== other.team;
        const close = opponent && !enemy;
        if (close) enemy = true;
        Object.assign(other, {
          x: close ? 8 : -28 + (index % 8) * 3,
          z: close ? 0 : 24 + Math.floor(index / 8) * 3,
          hp: 10000,
          maxHp: 10000,
          spawnShield: 0,
        });
        index++;
      }
    const grant = world.gain.bind(world);
    world.gain = () => {}; // Suppress random combat XP; grant real levels deliberately below.
    const held = !!world.mode.rules;
    if (held) world.mode.phase = "waiting";
    latest = { world, p, grant, held, healEvents: 0, events: [] };
    rooms.set(socket.id, latest);
    socket.emit("welcome", { id: p.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (input) =>
    rooms.get(socket.id)?.world.setInput(socket.id, input),
  );
  socket.on("upgrade", (key) =>
    rooms.get(socket.id)?.world.choose(socket.id, key),
  );
  socket.on("latency", (callback) => callback());
  socket.on("disconnect", () => rooms.delete(socket.id));
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
let tick = 0;
const timer = setInterval(() => {
  for (const [id, r] of rooms) {
    if (!r.held) r.world.step();
    else r.world.events = [];
    r.healEvents += r.world.events.filter(
      (e) => e.type === "heal" && e.owner === id,
    ).length;
    r.events.push(...r.world.events);
    if (tick % 2 === 0) {
      io.sockets.sockets.get(id)?.emit("state", r.world.snapshot(id, r.events));
      r.events.length = 0;
    }
  }
  tick++;
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
const reports = [],
  errors = [];
let currentCase = "initialization";
mkdirSync("/tmp/archer-validation", { recursive: true });
try {
  for (const touch of [true, false]) {
    const context = await browser.newContext({
      viewport: touch
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
      hasTouch: touch,
      isMobile: touch,
    });
    await context.addInitScript(() =>
      localStorage.setItem("wildbow-performance", "true"),
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/?server=http://127.0.0.1:${http.address().port}`);
    await expect(page.locator("#lobby")).toBeVisible();
    await selectControlMode(page, touch ? "onehand" : "classic", { touch });
    const cdp =
      touch && engine === "chromium" ? await context.newCDPSession(page) : null;
    const down = async () => {
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ id: 1, x: 195, y: 720 }],
        });
      else {
        await page.mouse.move(195, 720);
        await page.mouse.down();
      }
    };
    const move = async (x, y = 720) => {
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ id: 1, x, y }],
        });
      else await page.mouse.move(x, y);
    };
    const up = async () => {
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      else await page.mouse.up();
    };
    const formats = touch ? Object.keys(FORMATS) : ["arena", "duel", "brduo"];
    for (const format of formats) {
      currentCase = `${engine} ${touch ? "onehand" : "desktop"} ${format}`;
      await page.locator("#match-format").selectOption(format);
      await page.locator("#online-mode").click();
      await page.locator("#play").click();
      await expect(page.locator("#hud")).toBeVisible();
      const r = latest,
        p = r.p;
      await expect(page.locator("#first-game-tutorial")).toBeHidden();
      if (r.held) {
        await expect(page.locator("#dash")).toBeDisabled();
        await expect(page.locator("#heal")).toBeDisabled();
        if (touch) {
          await down();
          await move(230);
        } else await page.keyboard.down("KeyD");
        await page.keyboard.press("Space");
        await page.waitForTimeout(100);
        assert.equal(p.x, 0, "countdown cannot move the authority");
        r.world.mode.phase = "playing";
        r.held = false;
        await expect.poll(() => p.x).toBeGreaterThan(0.3);
        if (touch) await up();
        else await page.keyboard.up("KeyD");
      }
      await expect(page.locator("#dash")).toBeEnabled();
      assert.equal(p.dashCd, 0, "waiting input cannot queue a spawn dash");
      const x = p.x;
      if (touch) {
        await down();
        await move(240);
      } else await page.keyboard.down("KeyD");
      await expect.poll(() => p.x - x).toBeGreaterThan(0.4);
      if (touch) await up();
      else await page.keyboard.up("KeyD");
      await expect.poll(() => Math.hypot(p.vx, p.vz)).toBe(0);
      if (touch) {
        await down();
        await move(240);
        await move(325);
      } else {
        await page.keyboard.down("KeyD");
        await page.keyboard.press("Space");
      }
      await expect.poll(() => p.dashCd).toBeGreaterThan(0);
      if (touch) await up();
      else await page.keyboard.up("KeyD");
      await expect(page.locator("#dash")).toBeDisabled();
      p.hp = 40;
      p.healCd = 0;
      if (!touch) await page.keyboard.press("KeyE");
      await expect.poll(() => p.healCd).toBeGreaterThan(0);
      assert.ok(p.hp >= 65 && p.hp < 70, "healing uses the existing +25 cap");
      await expect(
        page.locator(".word-heal:visible").filter({ hasText: "CAN" }),
      ).toBeVisible();
      assert.equal(r.healEvents, 1);
      if (format === "brduo" && touch)
        await page.screenshot({
          path: `/tmp/archer-validation/stability-heal-${engine}.png`,
        });
      if (touch) {
        await down();
        await move(230);
      }
      r.grant(p, p.level * 55 - p.xp);
      p.choices = ["speed", "draw", "vitality"];
      await expect(page.locator("#upgrades")).toBeVisible();
      const hp = p.hp;
      r.world.damage(p, 1000);
      assert.equal(p.hp, hp, "selection guard remains authoritative");
      if (touch) {
        // The first new pull after the cards appear must select, without a second rebase move.
        await move(175);
        await expect(
          page.locator("#upgrade-options button").first(),
        ).toHaveClass(/stick-selected/);
        if (format === "brduo")
          await page.screenshot({
            path: `/tmp/archer-validation/stability-cards-${engine}.png`,
          });
        await up();
      } else await page.keyboard.press("1");
      await expect(page.locator("#upgrades")).toBeHidden();
      assert.equal(p.levelGuard, 0);
      assert.equal(p.upgrades.speed, 1);
      const metrics = await page
        .locator("#performance-monitor")
        .evaluate((e) => ({ ...e.dataset }));
      reports.push({
        format,
        touch,
        population: r.world.players.size,
        metrics,
      });
      await page.locator("#leaders-toggle").click();
      await page.locator("#exit").click();
      await expect(page.locator("#lobby")).toBeVisible();
      console.log(
        `GAMEPLAY_MODE_OK ${engine} ${touch ? "onehand" : "desktop"} ${format}`,
      );
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    `/tmp/archer-validation/stability-modes-${engine}.json`,
    JSON.stringify(
      {
        hardware: "Headless software GPU; not a physical iPhone FPS benchmark",
        reports,
      },
      null,
      2,
    ),
  );
} catch (error) {
  annotateFailure(error, `All-mode gameplay controls: ${currentCase}`);
  throw error;
} finally {
  clearInterval(timer);
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
}
