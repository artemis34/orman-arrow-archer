import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const errors = [];
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
});
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:3000");
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
await page.locator("#exit").click();
await page.locator("#online-mode").click();
await page.locator("#server-url").fill("http://127.0.0.1:3000");
await page.locator("#play").click();
await page.locator("#hud").waitFor({ state: "visible" });
await page.waitForTimeout(600);
assert.equal(await page.locator("#connection").textContent(), "CANLI");
assert.equal(await page.locator("#hud-name").textContent(), "Test Okçu");
await page.locator("#exit").click();
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
const m = await mobile.newPage();
m.on("pageerror", (e) => errors.push(e.message));
await m.goto("http://127.0.0.1:3000");
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
  tx = box.x + box.width / 2,
  ty = box.y + box.height / 2;
await cd.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: tx + 30, y: ty, id: 1 }],
});
await m.waitForTimeout(650);
assert.ok(parseInt(await m.locator("#charge-percent").textContent()) > 20);
await cd.send("Input.dispatchTouchEvent", {
  type: "touchEnd",
  touchPoints: [],
});
await m.waitForTimeout(300);
await expect(m.locator("#charge-percent")).toHaveText("0%", { timeout: 8000 });
await m.locator("#dash").tap();
await m.waitForTimeout(150);
await expect(m.locator("#dash-time")).not.toHaveText("HAZIR", {
  timeout: 8000,
});
assert.deepEqual(errors, []);
console.log(
  "Browser smoke passed: desktop local play, charge/release, dash, online join, mobile layout, no runtime errors.",
);
await browser.close();
