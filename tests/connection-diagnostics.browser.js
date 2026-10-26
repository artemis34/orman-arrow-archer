import { chromium, webkit, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { WebSocketTransport } from "../client/websocket.js";
import { annotateFailure } from "./report.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const room = `route-${Date.now().toString(36)}`;
let game, heartbeat;
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
let page;
try {
  game = new WebSocketTransport(
    base,
    () => {},
    () => {},
    { room },
  );
  await game.connect("Route fixture", 0);
  heartbeat = setInterval(() => game.step({ x: 0, z: 0 }), 1000 / 30);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() =>
    localStorage.setItem("wildbow-performance", "true"),
  );
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?room=${room}`);
  await expect(page.locator("#lobby")).toBeVisible();
  await page.locator("#online-mode").click();
  await page.locator("#play").click();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#performance-room")).toHaveText(`Oda ${room}`);
  await page.locator("#leaders-toggle").click();
  await page.locator("#exit").click();
  await expect(page.locator("#lobby")).toBeVisible();
  await page.locator("#collection-open").click();
  const link = page.locator("#connection-test-open");
  await expect(link).toBeVisible();
  assert.equal(
    new URL(await link.getAttribute("href")).searchParams.get("room"),
    room,
  );
  mkdirSync("/tmp/archer-validation", { recursive: true });
  await page.screenshot({
    path: `/tmp/archer-validation/connection-settings-${engine}.png`,
  });
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const testPage = await popupPromise;
  await testPage.waitForLoadState();
  await page.close();
  page = testPage;
  page.on("pageerror", (e) => errors.push(e.message));
  const sockets = [],
    requests = [];
  page.on("websocket", (ws) => sockets.push(ws.url()));
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));
  const status = async () =>
    (await fetch(`${base}/api/rooms/${room}/status`)).json();
  const before = await status();
  assert.equal(before.humans, 1);
  await page.locator("#start").click();
  await expect(page.locator("#status")).toContainText("Ölçüm tamamlandı", {
    timeout: 45000,
  });
  await expect(page.locator("#rows tr")).toHaveCount(3);
  assert.equal(sockets.length, 3);
  for (const row of await page.locator("#rows tr").allTextContents())
    assert.match(row, /20\/20/);
  const report = await page.locator("#report").inputValue();
  assert.match(report, new RegExp(room));
  assert.match(report, /Cloudflare girişi/);
  assert.ok(
    !requests.some((p) => /matchmake|profile|presence|leaderboard/.test(p)),
    "diagnostics cannot join, award RP or write a profile",
  );
  const after = await status();
  assert.equal(after.humans, 1);
  assert.equal(after.ticking, true);
  assert.ok(
    after.time - before.time > 3,
    "the real game continues while probes run",
  );
  const rect = await page.locator("#results").boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
  await page.screenshot({
    path: `/tmp/archer-validation/connection-result-${engine}.png`,
    fullPage: true,
  });
  await page.locator("#start").click();
  await expect(page.locator("#start")).toHaveText("İptal et");
  await page.locator("#start").click();
  await expect(page.locator("#status")).toContainText("durduruldu");
  await expect(page.locator("#results")).toBeHidden();
  assert.deepEqual(errors, []);
  console.log(
    `CONNECTION_DIAGNOSTICS_OK ${engine}: same-device edge/regional/actual-room echo, settings link, live-room isolation, bounded samples, cancellation and mobile layout.`,
  );
} catch (error) {
  await page
    ?.screenshot({
      path: `/tmp/archer-validation/connection-failure-${engine}.png`,
      fullPage: true,
    })
    .catch(() => {});
  annotateFailure(error, "Connection diagnostics");
  throw error;
} finally {
  clearInterval(heartbeat);
  game?.close();
  await browser.close();
}
