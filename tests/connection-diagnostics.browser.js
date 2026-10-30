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
let page,
  deadline,
  phase = "fixture join";
try {
  await Promise.race([
    (async () => {
      game = new WebSocketTransport(
        base,
        () => {},
        () => {},
        { room },
      );
      await game.connect("Route fixture", 0);
      heartbeat = setInterval(() => game.step({ x: 0, z: 0 }), 1000 / 30);
      phase = "mobile lobby";
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        // Controlled delayed-response fixtures must reach Playwright's router.
        // The shipped Service Worker is covered by the separate offline test.
        serviceWorkers: "block",
      });
      await context.addInitScript(() =>
        localStorage.setItem("wildbow-performance", "true"),
      );
      page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/?room=${room}`);
      await expect(page.locator("#lobby")).toBeVisible();
      await page.locator("#online-mode").tap();
      await page.locator("#play").tap();
      await expect(page.locator("#hud")).toBeVisible();
      await expect(page.locator("#performance-room")).toHaveText(`Oda ${room}`);
      await page.locator("#leaders-toggle").tap();
      await page.locator("#exit").tap();
      await expect(page.locator("#lobby")).toBeVisible();
      let releaseProfile, notifyProfile;
      const profileRequested = new Promise((resolve) => {
        notifyProfile = resolve;
      });
      await page.route("**/api/profile", async (route) => {
        await new Promise((release) => {
          releaseProfile = release;
          notifyProfile();
        });
        await route.continue();
      });
      phase = "delayed settings profile";
      await page.locator("#collection-open").tap();
      await expect(page.locator("#collection")).toBeVisible();
      await profileRequested;
      const settingsNode = await page
        .locator(".collection-content .settings-controls")
        .elementHandle();
      const fps = page.locator('[data-setting="performance"]');
      await fps.selectOption("false");
      const profileDone = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/profile",
      );
      releaseProfile();
      await (await profileDone).finished();
      await page.evaluate(
        () => new Promise((resolve) => setTimeout(resolve, 0)),
      );
      assert.equal(
        await settingsNode.evaluate((node) => node.isConnected),
        true,
        "profile refresh cannot detach active settings",
      );
      await expect(fps).toHaveValue("false");
      await fps.selectOption("true");
      await page.unroute("**/api/profile");
      phase = "settings connection link";
      const link = page.locator("#connection-test-open");
      await expect(link).toBeVisible();
      assert.equal(
        new URL(await link.getAttribute("href")).searchParams.get("room"),
        room,
      );
      mkdirSync("/tmp/archer-validation", { recursive: true });
      await link.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/archer-validation/connection-settings-${engine}.png`,
      });
      const popupPromise = page.waitForEvent("popup");
      await link.tap();
      const testPage = await popupPromise;
      await testPage.waitForLoadState();
      await page.close();
      page = testPage;
      phase = "native connection probes";
      await expect(page.locator('[data-connection-version="2"]')).toBeVisible();
      page.on("pageerror", (e) => errors.push(e.message));
      const sockets = [],
        requests = [];
      page.on("websocket", (ws) => sockets.push(ws.url()));
      page.on("request", (r) => requests.push(new URL(r.url()).pathname));
      const status = async () =>
        (await fetch(`${base}/api/rooms/${room}/status`)).json();
      const before = await status();
      assert.equal(before.humans, 1);
      const infoRequest = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/connection-info",
      );
      await page.locator("#start").tap();
      const info = await (await infoRequest).json();
      await expect(page.locator("#status")).toContainText("Ölçüm tamamlandı", {
        timeout: 45000,
      });
      const expectedPaths = info.alternateRegion ? 4 : 3;
      await expect(page.locator("#rows tr")).toHaveCount(expectedPaths);
      assert.equal(sockets.length, expectedPaths);
      for (const row of await page.locator("#rows tr").allTextContents())
        assert.match(row, /20\/20/);
      const report = await page.locator("#report").inputValue();
      assert.match(report, new RegExp(room));
      assert.match(report, /Cloudflare girişi/);
      assert.match(report, /WebSocket giriş yolu/);
      assert.ok(!report.includes("undefined"));
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
      if (["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
        phase = "European UI fixture";
        // EU capability rendering fixture only; the genuine provider path was tested above.
        await page.route("**/api/connection-info", async (route) => {
          const response = await route.fetch();
          await route.fulfill({
            response,
            json: {
              ...(await response.json()),
              region: "eeur",
              alternateRegion: "weur",
            },
          });
        });
        await page.routeWebSocket(
          "**/api/connection-probe?target=alternate",
          (ws) => {
            ws.send(
              JSON.stringify({
                type: "ready",
                context: { humans: 0, ticking: false, format: null },
              }),
            );
            ws.onMessage((raw) => {
              const packet = JSON.parse(raw);
              ws.send(JSON.stringify({ type: "probe", id: packet.id }));
            });
          },
        );
        await page.locator("#start").tap();
        await expect(page.locator("#status")).toContainText(
          "Ölçüm tamamlandı",
          {
            timeout: 45000,
          },
        );
        await expect(page.locator("#rows tr")).toHaveCount(4);
        await expect(page.locator("#rows")).toContainText("WEUR");
        await page.unroute("**/api/connection-info");
        console.log(`CONNECTION_EU_UI_FIXTURE_OK ${engine}`);
      }
      phase = "probe cancellation";
      await page.locator("#start").tap();
      await expect(page.locator("#start")).toHaveText("İptal et");
      await page.locator("#start").tap();
      await expect(page.locator("#status")).toContainText("durduruldu");
      await expect(page.locator("#results")).toBeHidden();
      assert.deepEqual(errors, []);
      console.log(
        `CONNECTION_DIAGNOSTICS_OK ${engine}: same-device edge/regional/actual-room echo, settings link, live-room isolation, bounded samples, cancellation and mobile layout.`,
      );
    })(),
    new Promise((_, reject) => {
      deadline = setTimeout(
        () =>
          reject(new Error(`Connection test timed out: ${engine}, ${phase}`)),
        120000,
      );
    }),
  ]);
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
  clearTimeout(deadline);
  clearInterval(heartbeat);
  game?.close();
  await browser.close();
}
