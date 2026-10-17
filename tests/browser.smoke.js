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
  await expect(page.locator("#dash-time")).not.toHaveText("HAZIR", {
    timeout: 8000,
  });
  await page.screenshot({ path: "/tmp/archer-validation/game-desktop.png" });
  await page
    .locator(
      "body:has(#death:not(.hidden)) #back-lobby, body:has(#death.hidden) #exit",
    )
    .click();
  await page.locator("#online-mode").click();
  await page.locator("#server-url").fill(baseUrl);
  await page.locator("#play").click();
  await page.locator("#hud").waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  assert.equal(await page.locator("#connection").textContent(), "CANLI");
  assert.equal(await page.locator("#hud-name").textContent(), "Test Okçu");
  await page
    .locator(
      "body:has(#death:not(.hidden)) #back-lobby, body:has(#death.hidden) #exit",
    )
    .click();
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
  await expect(m.locator("#dash-time")).not.toHaveText("HAZIR", {
    timeout: 8000,
  });
  await m.setViewportSize({ width: 844, height: 390 });
  await expect(m.locator("#move-stick")).toBeVisible();
  await expect(m.locator("#aim-stick")).toBeVisible();
  assert.equal(
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  const leaderboard = await m.locator(".leaderboard").boundingBox(),
    charge = await m.locator(".charge-display").boundingBox();
  assert.ok(
    leaderboard.y + leaderboard.height <= charge.y,
    "Landscape HUD panels must not overlap",
  );
  await m.screenshot({ path: "/tmp/archer-validation/game-landscape.png" });
  // Combat continues during this test; a legitimate elimination has its own menu action.
  await m
    .locator(
      "body:has(#death:not(.hidden)) #back-lobby, body:has(#death.hidden) #exit",
    )
    .tap();
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
    "Browser smoke passed: desktop play, charge/release, dash, online join, simultaneous mobile sticks, focus recovery, landscape, blocked storage/audio, no runtime errors.",
  );
} catch (error) {
  annotateFailure(error, "Desktop/mobile browser validation");
  throw error;
} finally {
  await browser.close();
}
