import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
const url = process.env.LIVE_SITE_URL;
if (!url)
  throw new Error("LIVE_SITE_URL must point to the published HTTPS game.");
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
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("requestfailed", (req) => {
      if (req.failure()?.errorText !== "net::ERR_ABORTED")
        errors.push(`${req.url()}: ${req.failure()?.errorText}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`);
    });
    const response = await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(response.status(), 200);
    await expect(page.locator("#lobby")).toBeVisible();
    await page.locator("#player-name").fill("Live Smoke");
    await page.locator("#play").click();
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#hud-name")).toHaveText("Live Smoke");
    if (mobile) {
      const box = await page.locator("#aim-stick").boundingBox();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: box.x + box.width / 2 + 30, y: box.y + box.height / 2, id: 1 },
        ],
      });
      await expect
        .poll(
          async () =>
            parseInt(await page.locator("#charge-percent").textContent()),
          { timeout: 15000 },
        )
        .toBeGreaterThan(20);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await page.mouse.move(800, 350);
      await page.mouse.down();
      await expect
        .poll(
          async () =>
            parseInt(await page.locator("#charge-percent").textContent()),
          { timeout: 15000 },
        )
        .toBeGreaterThan(20);
      await page.mouse.up();
    }
    await expect(page.locator("#charge-percent")).toHaveText("0%", {
      timeout: 15000,
    });
    assert.equal(
      await page
        .locator("#arena")
        .evaluate((canvas) => canvas.getContext("webgl2").isContextLost()),
      false,
    );
    await page.screenshot({
      path: `/tmp/archer-live/${mobile ? "mobile" : "desktop"}.png`,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    `LIVE_BROWSER_OK ${url}: desktop and mobile joined, charged/released arrows, WebGL active, all assets loaded.`,
  );
} finally {
  await browser.close();
}
