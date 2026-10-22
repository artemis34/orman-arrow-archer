import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const browser = await chromium.launch({
  headless: true,
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
});
mkdirSync("/tmp/archer-validation", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator("#lobby")).toBeVisible();
  const identity = await page.evaluate(() =>
    localStorage.getItem("wildbow-profile-key"),
  );
  assert.match(identity, /^[a-f0-9]{64}$/);
  await page.locator("#collection-open").tap();
  await expect(page.locator(".collection-status")).toContainText(
    "Online maç tamamla",
  );
  await page.locator('[data-tab="looks"]').tap();
  await expect(page.locator(".cosmetic-sample svg")).toHaveCount(3);
  await page
    .locator(".cosmetic-card")
    .filter({ hasText: "Ay yayı" })
    .locator("button")
    .tap();
  await expect(page.locator(".collection-status")).toContainText(
    "Yeterli yaprak yok",
  );
  await expect(page.locator("#collection-balance")).toHaveText("◇ 0");
  await page.locator('[data-tab="profile"]').tap();
  await expect(page.locator(".achievement")).toHaveCount(4);
  await page.screenshot({
    path: "/tmp/archer-validation/profile-cloudflare-phone.png",
  });
  await page.locator('[data-tab="settings"]').tap();
  await page
    .locator(".collection-content label")
    .filter({ hasText: "Joystick boyutu" })
    .locator("select")
    .selectOption("large");
  await page.locator("#collection-close").tap();
  await page.reload();
  await expect(page.locator("#lobby")).toBeVisible();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("wildbow-profile-key")),
    identity,
  );
  // Verify the shipped offline shell, without caching any private API response.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const keys = await caches.keys();
          for (const key of keys)
            if (key.startsWith("wildbow-shell-")) {
              const requests = await (await caches.open(key)).keys();
              if (requests.some((r) => /\/assets\/index-.*\.js/.test(r.url)))
                return requests.length;
            }
          return 0;
        }),
      { timeout: 15000 },
    )
    .toBeGreaterThan(3);
  assert.equal(
    await page.evaluate(async () => {
      for (const key of await caches.keys())
        for (const request of await (await caches.open(key)).keys())
          if (new URL(request.url).pathname.startsWith("/api/")) return true;
      return false;
    }),
    false,
  );
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#lobby")).toBeVisible();
  await page.locator("#practice-mode").tap();
  await page.locator("#match-format").selectOption("t8");
  await page.locator("#play").tap();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#population")).toHaveText("1 OYUNCU · 15 BOT");
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator("#leaders-toggle").tap();
    for (const selector of ["#exit", ".arena-session .sound-button"]) {
      const b = await page.locator(selector).boundingBox();
      assert.ok(
        b && b.x >= 0 && b.x + b.width <= width + 1,
        `${selector} fits a full team's mobile toolbar`,
      );
    }
    await page.locator("#leaders-toggle").tap();
    const boxes = [];
    for (const id of ["move-stick", "aim-stick", "dash", "heal", "auto-fire"]) {
      const b = await page.locator(`#${id}`).boundingBox();
      assert.ok(
        b &&
          b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= width + 1 &&
          b.y + b.height <= height + 1,
        `${id} fits ${width}x${height}`,
      );
      boxes.push(b);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        assert.ok(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          `large controls do not overlap at ${width}x${height}`,
        );
      }
  }
  await page.locator("#leaders-toggle").tap();
  await page.locator("#exit").tap();
  await expect(page.locator("#lobby")).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "PROFILE_BROWSER_OK real Cloudflare persistence, insufficient-balance rejection, SVG cosmetics, achievements and offline practice without caching API responses.",
  );
} finally {
  await browser.close();
}
