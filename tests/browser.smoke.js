import { annotateFailure } from "./report.js";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
const baseUrl = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
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
async function returnToLobby(page, touch = false) {
  const activate = (selector, timeout = 5000) =>
    touch
      ? page.locator(selector).tap({ timeout })
      : page.locator(selector).click({ timeout });
  if (await page.locator("#death").isVisible()) await activate("#back-lobby");
  else
    try {
      if (!(await page.locator("#leader-panel").isVisible()))
        await activate("#leaders-toggle");
      await activate("#exit", 1500);
    } catch (error) {
      if (!(await page.locator("#death").isVisible())) throw error;
      await activate("#back-lobby");
    }
  await expect(page.locator("#lobby")).toBeVisible();
}
try {
  const errors = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(baseUrl);
  await page.locator("#lobby").waitFor({ state: "visible" });
  await page.screenshot({ path: "/tmp/archer-validation/lobby-desktop.png" });
  await page.locator("#player-name").fill("Test Okçu");
  await page.locator("#play").click();
  await page.locator("#hud").waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  assert.equal(await page.locator("#hud-name").textContent(), "Test Okçu");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyW");
  await expect(page.locator("#dash")).toBeEnabled({ timeout: 6500 });
  await page.mouse.move(950, 410);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/archer-validation/charging.png" });
  await expect
    .poll(
      async () => parseInt(await page.locator("#charge-percent").textContent()),
      { timeout: 8000 },
    )
    .toBeGreaterThan(80);
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  await expect(page.locator("#dash-time")).toHaveText(/\d/, {
    timeout: 8000,
  });
  await page.screenshot({ path: "/tmp/archer-validation/game-desktop.png" });
  await returnToLobby(page);
  await page.locator("#online-mode").click();
  await page.locator("#server-url").fill(baseUrl);
  await page.locator("#play").click();
  await page.locator("#hud").waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  assert.equal(await page.locator("#connection").textContent(), "ONLINE");
  assert.equal(await page.locator("#hud-name").textContent(), "Test Okçu");
  await returnToLobby(page);
  await page.close();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const m = await mobile.newPage();
  m.on("pageerror", (e) => errors.push(e.message));
  await m.goto(baseUrl);
  await m.locator("#lobby").waitFor({ state: "visible" });
  await m.screenshot({ path: "/tmp/archer-validation/lobby-mobile.png" });
  await m.locator("#play").click();
  await m.locator("#hud").waitFor({ state: "visible" });
  await m.waitForTimeout(500);
  assert.ok(await m.locator("#move-stick").isVisible());
  assert.equal(
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await m.screenshot({ path: "/tmp/archer-validation/game-mobile.png" });
  // A tap on open arena space is an auto-shot request, even with no target.
  await m.touchscreen.tap(195, 330);
  await expect
    .poll(
      async () =>
        `${await m.locator("#toast").textContent()} ${await m.locator("#charge-hint").textContent()}`,
    )
    .toMatch(/Hedef yok|YENİ ATIŞ/);
  // Bots may leave line of sight between a HUD update and a tap. Retry only
  // when the UI offers a target, as a player would, until a shot is confirmed.
  const tapBox = await m.locator("#aim-stick").boundingBox();
  await expect
    .poll(
      async () => {
        if (
          (await m.locator("#charge-hint").textContent()).startsWith(
            "OTO HEDEF:",
          )
        )
          await m.touchscreen.tap(
            tapBox.x + tapBox.width * 0.7,
            tapBox.y + tapBox.height / 2,
          );
        return m.locator("#charge-hint").textContent();
      },
      { timeout: 30000, intervals: [100, 200, 300] },
    )
    .toContain("YENİ ATIŞ");
  // Start a fresh match so combat during target testing cannot affect stick tests.
  await m.reload();
  await m.locator("#play").click();
  await expect(m.locator("#hud")).toBeVisible();

  const cd = await mobile.newCDPSession(m),
    box = await m.locator("#aim-stick").boundingBox(),
    moveBox = await m.locator("#move-stick").boundingBox();
  const aimTouch = {
      x: box.x + box.width / 2 + 30,
      y: box.y + box.height / 2,
      id: 2,
    },
    moveTouch = {
      x: moveBox.x + moveBox.width / 2 + 25,
      y: moveBox.y + moveBox.height / 2 - 25,
      id: 1,
    };
  const minimapPoint = () =>
    m.locator("#minimap").evaluate((canvas) => {
      const { data } = canvas.getContext("2d").getImageData(0, 0, 160, 160);
      let x = 0,
        y = 0,
        n = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] > 220 && data[i + 1] > 240 && data[i + 2] > 165) {
          x += (i / 4) % 160;
          y += Math.floor(i / 4 / 160);
          n++;
        }
      return { x: x / n, y: y / n };
    });
  await expect
    .poll(async () => Number.isFinite((await minimapPoint()).x))
    .toBe(true);
  const beforeMove = await minimapPoint();
  await cd.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [moveTouch, aimTouch],
  });
  await expect
    .poll(
      async () => parseInt(await m.locator("#charge-percent").textContent()),
      { timeout: 8000 },
    )
    .toBeGreaterThan(20);
  await expect
    .poll(
      async () => {
        const p = await minimapPoint();
        return Math.hypot(p.x - beforeMove.x, p.y - beforeMove.y);
      },
      { timeout: 8000 },
    )
    .toBeGreaterThan(1);
  await m.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(m.locator("#charge-percent")).toHaveText("0%", {
    timeout: 8000,
  });
  // Old fingers are still on the screen: a new touch must work after focus reset.
  await cd.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      moveTouch,
      aimTouch,
      { ...aimTouch, id: 3, x: aimTouch.x - 5 },
    ],
  });
  await expect
    .poll(
      async () => parseInt(await m.locator("#charge-percent").textContent()),
      { timeout: 8000 },
    )
    .toBeGreaterThan(20);
  await cd.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(m.locator("#charge-percent")).toHaveText("0%", {
    timeout: 8000,
  });
  await m.locator("#dash").tap();
  await m.waitForTimeout(150);
  await expect(m.locator("#dash-time")).toHaveText(/\d/, {
    timeout: 8000,
  });
  await m.setViewportSize({ width: 844, height: 390 });
  await expect(m.locator("#move-stick")).toBeVisible();
  await expect(m.locator("#aim-stick")).toBeVisible();
  assert.equal(
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  const leaderboard = await m.locator("#leaders-toggle").boundingBox(),
    charge = await m.locator(".arena-actions").boundingBox();
  assert.ok(
    leaderboard.y + leaderboard.height <= charge.y,
    "Landscape HUD panels must not overlap",
  );
  await m.screenshot({ path: "/tmp/archer-validation/game-landscape.png" });
  // Combat continues during this test; a legitimate elimination has its own menu action.
  await returnToLobby(m, true);
  await expect(m.locator("#play")).toBeInViewport({ ratio: 1 });
  await m.screenshot({ path: "/tmp/archer-validation/lobby-landscape.png" });

  await mobile.close();
  const privateContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await privateContext.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });
    Object.defineProperty(window, "AudioContext", { value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { value: undefined });
  });
  const privatePage = await privateContext.newPage();
  privatePage.on("pageerror", (e) => errors.push(e.message));
  await privatePage.goto(baseUrl);
  await expect(privatePage.locator("#lobby")).toBeVisible();
  await privatePage.locator("#play").click();
  await expect(privatePage.locator("#hud")).toBeVisible();
  await expect(privatePage.locator("#hud-name")).toHaveText("Gezgin");
  await privateContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: desktop play, charge/release, dash, online join, mobile tap-to-fire, simultaneous mobile sticks, focus recovery, landscape, blocked storage/audio, no runtime errors.",
  );
} catch (error) {
  for (const [i, page] of browser
    .contexts()
    .flatMap((c) => c.pages())
    .entries()) {
    await page
      .screenshot({ path: `/tmp/archer-validation/failure-${i}.png` })
      .catch(() => {});
  }
  annotateFailure(error, "Desktop/mobile browser validation");
  throw error;
} finally {
  await browser.close();
}
