import { chromium, webkit, expect } from "@playwright/test";
import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { annotateFailure } from "./report.js";

// A hostname without a game server reproduces the standalone CDN edition.
// Every synthetic .test origin below stays inside this local test fixture.
const app = express();
app.use(express.static("dist"));
app.use((_req, res) => res.sendStatus(404));
const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
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
try {
  const context = await browser.newContext();
  const errors = [],
    requests = [];
  await context.route("https://static.example.test/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({ url: base + url.pathname + url.search }),
    });
  });
  for (const [host, online] of [
    ["arena-a.example.test", 7],
    ["arena-b.example.test", 12],
  ])
    await context.route(`https://${host}/**`, (route) => {
      requests.push(route.request().url());
      return route.fulfill({
        json: { online },
        headers: { "access-control-allow-origin": "*" },
      });
    });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) =>
    errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  await page.clock.install();
  await page.goto("https://static.example.test/");
  await expect(page.locator("#lobby")).toBeVisible();
  await expect(page.locator("#online-count")).toBeHidden();
  await page.clock.fastForward(30000);
  assert.deepEqual(
    requests,
    [],
    "standalone practice never polls a nonexistent game API",
  );
  assert.deepEqual(
    errors,
    [],
    "CDN HTML, scripts and assets must load without API 404s",
  );
  await page.locator("#play").click();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#connection")).toHaveText("YEREL");
  await expect(page.locator("#first-game-tutorial")).toBeHidden();

  await page.goto(
    "https://static.example.test/?server=https://arena-a.example.test",
  );
  await expect(page.locator("#online-count")).toHaveText("7 çevrimiçi oyuncu");
  await page.locator("#online-mode").click();
  await page.locator("#server-url").fill("https://arena-b.example.test");
  await page.clock.fastForward(30000);
  await expect(page.locator("#online-count")).toHaveText("12 çevrimiçi oyuncu");
  await page.locator("#server-url").fill("");
  const count = requests.length;
  await page.clock.fastForward(30000);
  await expect(page.locator("#online-count")).toBeHidden();
  assert.equal(
    requests.length,
    count,
    "clearing the configured server stops polling",
  );
  assert.deepEqual(requests, [
    "https://arena-a.example.test/api/presence",
    "https://arena-b.example.test/api/presence",
  ]);
  assert.deepEqual(errors, []);
  console.log(
    `STATIC_PRESENCE_OK ${engine}: standalone bot play, no missing API requests, configured server counts and runtime server changes.`,
  );
} catch (error) {
  annotateFailure(error, "Standalone presence polling");
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
