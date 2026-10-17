import { annotateFailure } from "./report.js";
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
let activePage;
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    let page = (activePage = await context.newPage());
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
    if ((await page.title()) === "External Content Notice | rawgit.hack") {
      // Follow the host's normal first-visit flow; do not bypass its notice.
      let opened;
      const onPage = (p) => {
        opened = p;
      };
      context.on("page", onPage);
      await page.getByText("Open the page", { exact: true }).click();
      context.off("page", onPage);
      if (opened) page = activePage = opened;
      await page.waitForLoadState("networkidle");
      console.log("HOST_NOTICE_ACKNOWLEDGED", page.url());
    }
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
} catch (error) {
  if (activePage) {
    const diagnostics = await activePage
      .evaluate(() => ({
        url: location.href,
        type: document.contentType,
        title: document.title,
        body: document.body?.innerText.slice(0, 2000),
      }))
      .catch((e) => ({ error: String(e) }));
    await activePage
      .screenshot({ path: "/tmp/archer-live/failure.png" })
      .catch(() => {});
    annotateFailure(
      new Error(JSON.stringify({ diagnostics, errors })),
      "Published page diagnostics",
    );
  }
  annotateFailure(error, "Published game validation");
  throw error;
} finally {
  await browser.close();
}
