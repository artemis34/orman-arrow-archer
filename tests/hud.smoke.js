import { selectControlMode } from "./helpers/control-mode.js";
import { installFloatingGestures } from "./helpers/floating-gestures.js";
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
    installFloatingGestures(page);
    page.on("pageerror", (e) => errors.push(e.message));
    const activate = (selector) =>
      page.locator(selector)[touch ? "tap" : "click"]();
    await page.goto(baseUrl);
    if (touch) await selectControlMode(page, "classic");
    await page.locator("#online-mode").click();
    await page.locator("#server-url").fill(fixtureUrl);
    await page.locator("#play").click();
    await expect(page.locator("#hud")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Start the five-second window after initial navigation and font loading,
    // so a slow CI browser doesn't consume it before any controls are usable.
    world.gain(world.players.get(id), 200);
    // Always cover the longest new description instead of depending on which
    // three random perks happen to be offered on this viewport.
    world.players.get(id).choices = ["lifesteal", "returning", "ricochet"];
    // Software-rendered CI browsers can take longer than the auto-pick timer
    // to measure every card; that timer is covered separately below.
    world.players.get(id).offerAt = Infinity;
    world.players.get(id).hp = 35;
    await expect(page.locator("#upgrades")).toBeVisible();
    await expect(page.locator("#upgrade-options button")).toHaveCount(3);
    await expect(page.locator("#upgrade-count")).toContainText("+1");
    const dock = await page.locator("#upgrades").boundingBox();
    assert.ok(
      dock.y + dock.height < height / 2,
      `${label}: cards stay above the character and out of the thumb area`,
    );
    assert.ok(
      dock.height < height * 0.25,
      `${label}: compact cards (${dock.height}px)`,
    );
    for (const card of await page.locator("#upgrade-options button").all()) {
      await expect(card.locator(".perk-value")).toBeVisible();
      assert.ok(
        (await card.innerText()).length < 65,
        "cards can be scanned during fast play",
      );
      assert.ok(
        await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
        "no card requires scrolling",
      );
    }
    assert.equal(
      await page.evaluate(
        () => document.elementFromPoint(innerWidth / 2, innerHeight / 2).id,
      ),
      "arena",
    );
    await activate("#upgrade-options button:first-child");
    await expect.poll(() => world.players.get(id).pending).toBe(1);
    world.players.get(id).offerAt = Infinity;
    await activate("#upgrade-options button:first-child");
    await expect(page.locator("#upgrades")).toBeHidden();
    // The final card ends the guard immediately; no remaining timer to wait for.
    assert.equal(world.players.get(id).levelGuard, 0);
    await expect
      .poll(() => world.players.get(id).levelGuard, { timeout: 4500 })
      .toBe(0);
    await expect(page.locator("#leader-panel")).toBeHidden();
    await expect(page.locator("#vitals-details")).toBeHidden();
    await expect(page.locator("#dash small")).toHaveText("ATIL");
    await expect(page.locator("#heal small")).toHaveText("+25 CAN");
    await expect(page.locator("#auto-fire small")).toHaveText("OTO KAPALI");
    await expect(page.locator("#xp-remaining")).toHaveText(
      `${world.players.get(id).level * 55 - world.players.get(id).xp} XP kaldı`,
    );
    const map = await page.locator(".arena-map").boundingBox();
    assert.ok(map.width >= 84, `${label}: readable collapsed map`);
    let area = 0;
    for (const selector of [
      ".arena-map",
      "#leaders-toggle",
      ".arena-vitals",
      ".arena-actions",
    ]) {
      const box = await page.locator(selector).boundingBox();
      area += box.width * box.height;
    }
    assert.ok(
      area / width / height < 0.1,
      `${label}: readable persistent HUD must occupy less than 10% of the screen`,
    );
    if (touch) {
      const action = await page.locator(".arena-actions").boundingBox();
      for (const stick of ["#move-stick", "#aim-stick"]) {
        const box = await page.locator(stick).boundingBox();
        const overlapX =
          Math.min(action.x + action.width, box.x + box.width) -
          Math.max(action.x, box.x);
        const overlapY =
          Math.min(action.y + action.height, box.y + box.height) -
          Math.max(action.y, box.y);
        assert.ok(
          overlapX <= 0 || overlapY <= 0,
          `${label}: actions leave both joysticks clear`,
        );
      }
    }
    await activate("#leaders-toggle");
    await expect(page.locator("#leader-panel")).toBeVisible();
    await activate("#map-toggle");
    await expect(page.locator("#leader-panel")).toBeHidden();
    await expect(page.locator("#map-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    assert.ok(
      (await page.locator(".arena-map").boundingBox()).width > map.width * 1.9,
      `${label}: the map visibly enlarges, beyond changing aria-expanded`,
    );
    if (touch) {
      // Some browsers emit a second compatibility click marked as mouse.
      await page.locator("#map-toggle").evaluate((el) =>
        el.dispatchEvent(
          new PointerEvent("click", {
            bubbles: true,
            detail: 1,
            pointerType: "mouse",
          }),
        ),
      );
      await expect(page.locator("#map-toggle")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }
    await activate("#vitals-toggle");
    await expect(page.locator("#vitals-details")).toBeVisible();
    await expect(page.locator("#map-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await activate("#vitals-toggle");
    await expect(page.locator("#vitals-details")).toBeHidden();
    await page.screenshot({
      path: `/tmp/archer-validation/compact-${label}.png`,
    });
    const p = world.players.get(id);
    world.gain(p, p.level * 55 - p.xp);
    p.offerAt = Infinity;
    await expect(page.locator("#upgrades")).toBeVisible();
    // Levelling never pauses the fight: abilities stay ready and hits land.
    await expect(page.locator("#dash")).toBeEnabled();
    assert.equal(p.levelGuard, 0);
    const before = { x: p.x, z: p.z, hp: p.hp };
    world.damage(p, 5);
    assert.ok(p.hp < before.hp, `${label}: hits still land while cards show`);
    let cd, move;
    if (touch) {
      cd = await context.newCDPSession(page);
      const box = await page.locator("#move-stick").boundingBox();
      move = {
        x: box.x + box.width / 2 + 22,
        y: box.y + box.height / 2,
        id: 1,
      };
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [move],
      });
    } else await page.keyboard.down("KeyD");
    // Walking continues with the cards on screen.
    await expect.poll(() => p.x - before.x).toBeGreaterThan(0.3);
    await page.screenshot({
      path: `/tmp/archer-validation/cards-${label}.png`,
    });
    if (touch) {
      const box = await page
        .locator("#upgrade-options button")
        .first()
        .boundingBox();
      const pick = {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        id: 2,
      };
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [move, pick],
      });
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [pick],
      });
      await expect.poll(() => p.pending).toBe(0);
      const after = p.x;
      await expect.poll(() => p.x - after).toBeGreaterThan(0.2);
      await cd.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await page.keyboard.press("Digit1");
      await page.keyboard.up("KeyD");
      await expect.poll(() => p.pending).toBe(0);
      await page.mouse.move(width / 2 + 150, height / 2);
      await page.mouse.down();
      await expect.poll(() => p.charge).toBeGreaterThan(0.1);
      await page.mouse.up();
    }
    await expect(page.locator("#upgrades")).toBeHidden();
    // Ignored cards are picked by the authority after the visible timer.
    world.gain(p, p.level * 55 - p.xp);
    await expect(page.locator("#upgrades")).toBeVisible();
    await expect
      .poll(() => p.pending, { timeout: (RULES.upgradeAutoPick + 3) * 1000 })
      .toBe(0);
    await expect(page.locator("#upgrades")).toBeHidden();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await context.close();
    console.log(
      `HUD_OK ${label}: ${((area / width / height) * 100).toFixed(1)}% idle HUD, actual map enlargement, ghost-click protection, non-blocking cards, walking while choosing, queued and automatic picks.`,
    );
  }
  assert.deepEqual(errors, []);
} catch (error) {
  for (const [i, page] of browser
    .contexts()
    .flatMap((c) => c.pages())
    .entries())
    await page
      .screenshot({ path: `/tmp/archer-validation/hud-failure-${i}.png` })
      .catch(() => {});
  annotateFailure(error, "Non-blocking selection and folded HUD");
  throw error;
} finally {
  await browser.close();
  clearInterval(timer);
  await new Promise((resolve) => io.close(resolve));
}
