import { chromium, webkit, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { annotateFailure } from "./report.js";

const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787",
  engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
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
const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  }),
  page = await context.newPage(),
  errors = [],
  network = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (response) => {
  const path = new URL(response.url()).pathname;
  if (path.startsWith("/api/"))
    network.push({ path, status: response.status(), at: Date.now() });
});
page.on("requestfailed", (request) => {
  const path = new URL(request.url()).pathname;
  if (path.startsWith("/api/"))
    network.push({ path, failure: request.failure()?.errorText });
});
page.on("websocket", (ws) => {
  const path = new URL(ws.url()).pathname;
  network.push({ websocket: path, at: Date.now() });
  ws.on("framereceived", ({ payload }) => {
    if (typeof payload !== "string") return;
    try {
      const p = JSON.parse(payload);
      if (["welcome", "error", "full"].includes(p.type))
        network.push({
          type: p.type,
          message: p.data?.message,
          at: Date.now(),
        });
    } catch {}
  });
  ws.on("socketerror", (error) =>
    network.push({ websocketError: String(error) }),
  );
  ws.on("close", () => network.push({ closed: path, at: Date.now() }));
});
mkdirSync("/tmp/archer-validation", { recursive: true });
async function leave() {
  if (await page.locator("#death").isVisible())
    await page.locator("#back-lobby").tap();
  else {
    await page.locator("#leaders-toggle").tap();
    await page.locator("#exit").tap();
  }
  await expect(page.locator("#lobby")).toBeVisible();
}
async function join(label) {
  const started = Date.now();
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible({ timeout: 17000 });
  await expect(page.locator("#connection")).toHaveText("ONLINE");
  console.log(`JOIN_OK ${engine} ${label} ${Date.now() - started}ms`);
}
try {
  await page.goto(base);
  await expect(page.locator("#lobby")).toBeVisible({ timeout: 20000 });
  await page.locator("#onehand-controls").tap();
  await expect(page.locator("#quick-match")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await join("fresh public arena with profile");
  await page.screenshot({
    path: `/tmp/archer-validation/join-${engine}-fresh.png`,
  });
  await leave();
  await join("same-page quick rejoin");
  await leave();
  await page.reload();
  await expect(page.locator("#lobby")).toBeVisible();
  await join("returning profile, service worker, saved invitation URL");
  await leave();
  if (process.env.JOIN_RECOVERY_TESTS === "1") {
    let requests = 0;
    await page.route("**/api/matchmake", async (route) => {
      if (++requests === 1)
        await route.fulfill({ status: 503, body: "Temporarily unavailable" });
      else await route.continue();
    });
    await join("automatic recovery from a transient matchmaking failure");
    assert.equal(requests, 2);
    await leave();
    await page.unroute("**/api/matchmake");

    requests = 0;
    await page.route("**/api/matchmake", async (route) => {
      if (++requests === 1) {
        const response = await route.fetch();
        const allocation = await response.json();
        await route.fulfill({
          response,
          json: { ...allocation, ticket: "expired-seat" },
        });
      } else await route.continue();
    });
    await join(
      "a rejected/expired public seat is replaced by a fresh reservation",
    );
    assert.equal(requests, 2);
    await leave();
    await page.unroute("**/api/matchmake");

    requests = 0;
    await page.route("**/api/matchmake", async (route) => {
      requests++;
      await route.fulfill({ status: 503, body: "Temporarily unavailable" });
    });
    await page.locator("#play").tap();
    await expect(page.locator("#play b")).toHaveText("OYNA");
    await expect(page.locator("#join-status")).toContainText(
      "Uygun arena bulunamadı",
    );
    assert.equal(
      requests,
      2,
      "failure retries are bounded; the join button remains usable",
    );
    await page.unroute("**/api/matchmake");

    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/api/matchmake", async (route) => {
      await held;
      await route.abort().catch(() => {});
    });
    const sockets = network.filter((entry) => entry.websocket).length;
    await page.locator("#play").tap();
    await expect(page.locator("#join-status")).toContainText(
      "Uygun arena aranıyor",
    );
    await expect(page.locator("#play b")).toHaveText("İPTAL ET");
    await page.locator("#play").tap();
    await expect(page.locator("#play b")).toHaveText("OYNA");
    await expect(page.locator("#join-status")).toContainText(
      "Bağlantı durduruldu",
    );
    release();
    await page.unrouteAll({ behavior: "wait" });
    assert.equal(network.filter((entry) => entry.websocket).length, sockets);
    await expect(page.locator("#hud")).toBeHidden();
    await join("new join after cancellation");
    await leave();
    await page.locator("#practice-mode").tap();
    await page.locator("#play").tap();
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#connection")).toHaveText("YEREL");
    await leave();
  }
  assert.deepEqual(errors, []);
  console.log(
    `::notice title=Public quick join ${engine}::${JSON.stringify(network)}`,
  );
} catch (error) {
  error.message += `\nJoin status: ${await page
    .locator("#join-status")
    .textContent()
    .catch(
      () => "unavailable",
    )}\nNetwork (no credentials): ${JSON.stringify(network)}\nPage errors: ${JSON.stringify(errors)}`;
  await page
    .screenshot({ path: `/tmp/archer-validation/join-${engine}-failure.png` })
    .catch(() => {});
  annotateFailure(error, `Public quick join ${engine}`);
  throw error;
} finally {
  await browser.close();
}
