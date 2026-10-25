import { chromium, webkit, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { Server } from "socket.io";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { selectControlMode } from "./helpers/control-mode.js";
import { annotateFailure } from "./report.js";

const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const base = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
const world = new World({ bots: 0 });
world.obstacles = [];
world.obstacleGrid.clear();
while (world.orbs.active.length) world.orbs.release(0);
const http = createServer(),
  io = new Server(http, { cors: { origin: true } });
let actor,
  joins = 0;
const actions = [];
const upgrades = [];
io.on("connection", (socket) => {
  socket.on("join", (data) => {
    joins++;
    actor = world.addPlayer(socket.id, data.name);
    Object.assign(actor, { x: 0, z: 0 });
    socket.emit("welcome", { id: actor.id, obstacles: [], rules: RULES });
  });
  socket.on("input", (input) => {
    if (input.dash || input.heal)
      actions.push({ dash: input.dash, heal: input.heal });
    world.setInput(socket.id, input);
  });
  socket.on("upgrade", (key) => {
    if (world.choose(socket.id, key))
      upgrades.push({ key, at: performance.now() });
  });
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
mkdirSync("/tmp/archer-validation", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/?server=http://127.0.0.1:${http.address().port}`);
  await expect(page.locator("#lobby")).toBeVisible();
  await expect(
    page.locator('#match-format option[value="ranked"]'),
  ).toHaveCount(0);
  await page.locator("#match-format").selectOption("duel");
  await expect(page.locator("#ranked-toggle")).toHaveCount(0);
  await page.locator("#match-format").selectOption("brduo");
  await expect(page.locator("#match-format option:checked")).toContainText(
    "Dereceli",
  );
  await page.locator("#match-format").selectOption("arena");
  await page.locator("#online-mode").tap();
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#first-game-tutorial")).toBeHidden();
  await expect(page.locator("#dash")).toBeHidden();
  await expect(page.locator("#heal")).toBeHidden();
  await expect.poll(() => !!actor?.input.autoFire).toBe(true);
  const cdp = engine === "chromium" ? await context.newCDPSession(page) : null;
  // Chromium uses genuine touch input; WebKit exercises the same captured
  // pointer handlers using a browser mouse in a mobile viewport.
  const start = async (x = 195, y = 720) => {
    if (cdp)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 1, x, y }],
      });
    else {
      await page.mouse.move(x, y);
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
  const end = async (cancel = false) => {
    if (cdp)
      await cdp.send("Input.dispatchTouchEvent", {
        type: cancel ? "touchCancel" : "touchEnd",
        touchPoints: [],
      });
    else if (cancel) {
      await page.dispatchEvent("#arena", "pointercancel", {
        pointerId: 1,
        pointerType: "mouse",
      });
      await page.mouse.up();
    } else await page.mouse.up();
  };
  const offer = async () => {
    const offeredAt = performance.now();
    world.gain(actor, actor.level * 55 - actor.xp);
    actor.choices = ["speed", "draw", "vitality"];
    await expect(page.locator("#upgrades")).toBeVisible();
    await expect(page.locator("#upgrade-options button")).toHaveCount(3);
    await expect(page.locator("#upgrade-options button").first()).toContainText(
      "Rüzgâr adımı",
    );
    return offeredAt;
  };
  // A normal walk is not a dodge; crossing the outer threshold is exactly one.
  actor.spawnShield = 0;
  const initial = actor.x;
  await start();
  await move(230);
  await expect.poll(() => actor.x - initial).toBeGreaterThan(0.3);
  assert.equal(actions.filter((a) => a.dash).length, 0);
  await move(250);
  await expect(page.locator("#dash-target")).toBeVisible();
  await move(325);
  await expect.poll(() => actions.filter((a) => a.dash).length).toBe(1);
  // Do not queue an automatic dodge when cooldown finishes under a held finger.
  actor.dashCd = 0;
  await move(335);
  await page.waitForTimeout(180);
  assert.equal(actions.filter((a) => a.dash).length, 1);
  await end();
  // Begin walking first, then level up. That held gesture must not choose.
  await start();
  await move(230);
  const offeredAt = await offer();
  await move(235); // rebase the already held finger into selection
  await move(235, 665);
  await expect.poll(() => actor.upgrades.draw || 0, { timeout: 8000 }).toBe(1);
  assert.ok(
    upgrades.at(-1).at - offeredAt >= 5000,
    "cards provide at least five seconds before automatic stick confirmation",
  );
  await expect(page.locator("#upgrades")).toBeHidden();
  await move(250, 665); // same captured finger resumes movement
  await expect.poll(() => actor.input.x).toBeGreaterThan(0);
  await end();
  await offer();
  assert.equal(actor.pending, 1);
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    for (const selector of [
      "#upgrades",
      "#joystick-card-hint",
      "#move-stick",
    ]) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
        `${width}x${height}: ${selector} stays on screen`,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Cancellation is one synchronous browser turn: a slow software renderer
  // must not turn a deliberately quick cancellation into a valid 600 ms hold.
  for (const cancelled of [false, true]) {
    await page.evaluate(() =>
      addEventListener(
        "pointerdown",
        (e) =>
          (window.__gestureFixture = { id: e.pointerId, type: e.pointerType }),
        { once: true, capture: true },
      ),
    );
    await start();
    const highlighted = await page.evaluate((cancelled) => {
      const p = window.__gestureFixture;
      const move = (type, x) =>
        dispatchEvent(
          new PointerEvent(type, {
            pointerId: p.id,
            pointerType: p.type,
            clientX: x,
            clientY: 720,
            bubbles: true,
          }),
        );
      move("pointermove", 150);
      const highlighted = document
        .querySelector("#upgrade-options button")
        ?.classList.contains("stick-selected");
      move(cancelled ? "pointercancel" : "pointermove", cancelled ? 150 : 195);
      delete window.__gestureFixture;
      return highlighted;
    }, cancelled);
    assert.equal(highlighted, true);
    await end(cancelled);
    assert.equal(actor.pending, 1);
  }
  for (const [index, x, y] of [
    [0, 150, 720],
    [1, 195, 670],
    [2, 240, 720],
  ]) {
    if (index) await offer();
    const keys = ["speed", "draw", "vitality"];
    const old = actor.upgrades[keys[index]] || 0;
    await start();
    await move(x, y);
    await expect
      .poll(
        async () =>
          actor.upgrades[keys[index]] === old + 1 ||
          (await page.evaluate(
            (index) =>
              document
                .querySelectorAll("#upgrade-options button")
                [index]?.classList.contains("stick-selected"),
            index,
          )),
      )
      .toBeTruthy();
    if (index === 0 && actor.pending)
      await page.screenshot({
        path: `/tmp/archer-validation/one-finger-${engine}-selection.png`,
      });
    const releasedAt = performance.now();
    await end();
    await expect.poll(() => actor.upgrades[keys[index]]).toBe(old + 1);
    assert.ok(
      upgrades.at(-1).at - releasedAt < 1500,
      "explicit choice is not held until the reading window expires",
    );
    await expect(page.locator("#upgrades")).toBeHidden();
    assert.equal(actor.levelGuard, 0, "selection ends protection immediately");
  }
  // HP just above the threshold does not spend healing; at 35% it is automatic.
  actor.hp = actor.maxHp * 0.35 + 1;
  actor.healCd = 0;
  const healsBefore = actions.filter((a) => a.heal).length;
  await page.waitForTimeout(200);
  assert.equal(actions.filter((a) => a.heal).length, healsBefore);
  // Stay below the threshold across snapshot latency/passive 0.8 HP/s regen.
  const lowHp = actor.maxHp * 0.35 - 2;
  actor.hp = lowHp;
  await expect.poll(() => actor.healCd).toBeGreaterThan(0);
  assert.ok(actor.hp >= lowHp + 25 && actor.hp < lowHp + 26);
  assert.equal(actions.filter((a) => a.heal).length, healsBefore + 1);
  await expect(page.locator("#heal-label")).toHaveText("OTO · +25");
  await page.screenshot({
    path: `/tmp/archer-validation/one-finger-${engine}-game.png`,
  });
  // Assist preferences are visible/persistent, with the classic controls intact.
  await page.locator("#leaders-toggle").tap();
  await page.locator("#exit").tap();
  await expect(page.locator("#lobby")).toBeVisible();
  await page.locator("#collection-open").tap();
  await page.locator('[data-tab="settings"]').tap();
  await page.locator('[data-setting="overpull"]').selectOption("false");
  await page.locator('[data-setting="autoheal"]').selectOption("false");
  await page.locator("#collection-close").tap();
  await page.reload();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("wildbow-autoheal")),
    "false",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("wildbow-overpull")),
    "false",
  );
  await page.locator("#online-mode").tap();
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible();
  await expect.poll(() => !!actor?.input.autoFire).toBe(true);
  await expect(page.locator("#heal-label")).toHaveText("+25 CAN");
  actor.hp = 30;
  actor.healCd = actor.dashCd = 0;
  const disabledActions = actions.length;
  await start();
  await move(325);
  await expect.poll(() => actor.input.x).toBeGreaterThan(0.5);
  await end();
  assert.equal(
    actions.length,
    disabledActions,
    "disabled helpers neither dodge nor heal",
  );
  await page.locator("#leaders-toggle").tap();
  await page.locator("#exit").tap();
  await expect(page.locator("#lobby")).toBeVisible();
  // How to play always starts a separate local lesson, even from ranked duo.
  await page.locator("#match-format").selectOption("brduo");
  const beforeLesson = joins;
  const savedUrl = page.url();
  const savedFormat = await page.evaluate(() =>
    localStorage.getItem("wildbow-format"),
  );
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.locator("#help-open").tap();
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#connection")).toHaveText("YEREL");
    await expect(page.locator("#first-game-tutorial")).toBeVisible();
    await expect(page.locator("#tutorial-title")).toContainText("1/4");
    await start();
    await move(240);
    await expect(page.locator("#tutorial-title")).toContainText("2/4");
    await move(325);
    await end();
    await expect(page.locator("#tutorial-title")).toContainText("3/4");
    assert.equal(joins, beforeLesson, "lesson never joins the online room");
    assert.equal(page.url(), savedUrl, "lesson preserves the online invite");
    await page.screenshot({
      path: `/tmp/archer-validation/tutorial-${engine}.png`,
    });
    await page.locator("#tutorial-skip").tap();
    await expect(page.locator("#lobby")).toBeVisible();
    await expect(page.locator("#first-game-tutorial")).toBeHidden();
    await expect(page.locator("#match-format")).toHaveValue("brduo");
    await expect(page.locator("#online-mode")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("wildbow-format")),
      savedFormat,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("wildbow-overpull")),
      "false",
      "lesson does not overwrite assist preferences",
    );
  }
  await page.locator("#match-format").selectOption("arena");
  await selectControlMode(page, "classic");
  await page.locator("#play").tap();
  await expect(page.locator("#aim-stick")).toBeVisible();
  await expect(page.locator("#joystick-card-hint")).toBeHidden();
  assert.deepEqual(errors, []);
  console.log(
    `ONE_FINGER_OK ${engine}: overpull once, cooldown hold, held-walk level, card preview/cancel/three directions, authoritative heal, saved settings and classic fallback.`,
  );
} catch (error) {
  error.message += `\nActor: ${JSON.stringify(actor && { hp: actor.hp, maxHp: actor.maxHp, healCd: actor.healCd, levelGuard: actor.levelGuard, pending: actor.pending, input: actor.input })}; actions: ${JSON.stringify(actions)}`;
  annotateFailure(error, "One-finger controls");
  throw error;
} finally {
  clearInterval(timer);
  await browser.close();
  await new Promise((resolve) => io.close(resolve));
}
