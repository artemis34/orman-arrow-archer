import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "vite";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { annotateFailure } from "./report.js";

const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
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
let page;
try {
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator("#lobby")).toBeVisible();
  await page.locator("#collection-open").click();
  const setting = page.locator('[data-setting="performance"]');
  await expect(setting).toBeVisible();
  await expect(setting).toHaveValue("false");
  await expect(page.locator("#performance-monitor")).toBeHidden();
  await setting.selectOption("true");
  await page.screenshot({
    path: `/tmp/archer-validation/performance-settings-${engine}.png`,
  });
  await page.locator("#collection-close").click();
  await page.locator("#play").click();
  const monitor = page.locator("#performance-monitor");
  await expect(monitor).toBeVisible();
  await expect(page.locator("#performance-frames")).toContainText("p95", {
    timeout: 15000,
  });
  await expect(page.locator("#performance-network")).toHaveText(
    "YEREL · Sunucu bağlantısı yok",
  );
  await expect(page.locator("#performance-network")).not.toContainText("0 ms");
  const values = await monitor.evaluate((element) => ({
    fps: Number(element.dataset.fps),
    p95: Number(element.dataset.p95Ms),
    ping: element.dataset.pingMs,
    pointerEvents: getComputedStyle(element).pointerEvents,
    rect: element.getBoundingClientRect().toJSON(),
  }));
  assert.ok(values.fps > 0 && values.p95 > 0);
  assert.equal(values.ping, "");
  assert.equal(values.pointerEvents, "none");
  assert.ok(values.rect.x >= 0 && values.rect.right <= 390);
  await page.screenshot({
    path: `/tmp/archer-validation/performance-overlay-${engine}.png`,
  });
  await page.locator("#map-toggle").click();
  const layout = await page.evaluate(() => ({
    map: document.getElementById("map-toggle").getBoundingClientRect().bottom,
    monitor: document
      .getElementById("performance-monitor")
      .getBoundingClientRect().top,
  }));
  assert.ok(layout.monitor > layout.map, "the monitor follows an expanded map");
  // The same visibility event used by real tab suspension resets the sample
  // window. The following frame establishes a baseline rather than a fake stall.
  assert.equal(
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      return document.getElementById("performance-monitor").dataset.fps;
    }),
    undefined,
  );
  await expect(page.locator("#performance-frames")).toContainText("p95", {
    timeout: 15000,
  });
  await page.reload();
  await expect(page.locator("#lobby")).toBeVisible();
  await page.locator("#collection-open").click();
  await expect(setting).toHaveValue("true");
  await setting.selectOption("false");
  await page.locator("#collection-close").click();
  await page.locator("#play").click();
  await expect(monitor).toBeHidden();
  assert.deepEqual(errors, []);
  console.log(
    `PERFORMANCE_MONITOR_OK ${engine}: settings, persisted toggle, real cadence, local RTT label, expanded map and visibility reset.`,
  );
} catch (error) {
  await page
    ?.screenshot({
      path: `/tmp/archer-validation/performance-monitor-${engine}-failure.png`,
    })
    .catch(() => {});
  annotateFailure(error, "Performance monitor");
  throw error;
} finally {
  await browser.close();
  await server.close();
}
