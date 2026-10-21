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
