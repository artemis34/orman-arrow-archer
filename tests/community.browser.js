import { chromium, webkit, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { annotateFailure } from "./report.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
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
let activePage;
try {
  const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    errors = [];
  activePage = page;
  let friendRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/profile/friends/request")
      friendRequests++;
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.locator("#lobby")).toBeVisible();
  const providers = await (await fetch(`${base}/api/auth/providers`)).json();
  await page.locator("#collection-open").tap();
  await page.locator("#account-options > summary").tap();
  for (const key of ["google", "apple"]) {
    await expect(
      page.locator(`#lobby-accounts [data-auth-provider="${key}"]`),
    ).toBeVisible();
    if (!providers.providers[key].configured)
      await expect(
        page.locator(`#lobby-accounts [data-auth-provider="${key}"]`),
      ).toBeDisabled();
  }
  await page.locator("#collection-close").tap();
  await page.locator("#friends-open").tap();
  await expect(page.locator("#collection")).toBeVisible();
  await expect(page.locator(".collection-content")).toContainText(
    "Arkadaş kodun",
  );
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const other = await (
    await fetch(`${base}/api/profile/name`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "WWWWWWWWWWWWWWWW" }),
    })
  ).json();
  await page
    .getByRole("textbox", { name: "Arkadaş kodu", exact: true })
    .fill(other.profile.socialCode);
  await page.getByRole("button", { name: "İstek gönder", exact: true }).tap();
  await expect(page.locator(".collection-content")).toContainText(
    "Onay bekleniyor",
  );
  assert.equal(
    friendRequests,
    1,
    "one touch submits exactly one friend request",
  );
  const myToken = await page.evaluate(() =>
    localStorage.getItem("wildbow-profile-key"),
  );
  const mine = await (
    await fetch(`${base}/api/profile`, {
      headers: { Authorization: `Bearer ${myToken}` },
    })
  ).json();
  const accepted = await fetch(`${base}/api/profile/friends/accept`, {
    method: "POST",
    headers,
    body: JSON.stringify({ target: mine.profile.socialCode }),
  });
  assert.equal(accepted.status, 200);
  await page.locator('[data-tab="profile"]').tap();
  await expect(page.locator(".rank-summary")).toHaveCount(2);
  for (const [i, label] of ["Solo BR", "İkili BR"].entries()) {
    await expect(page.locator(".rank-summary").nth(i)).toContainText(label);
    await expect(page.locator(".rank-summary").nth(i)).toContainText(
      "Tohum · 0 RP",
    );
  }
  await page.locator('[data-tab="friends"]').tap();
  await expect(page.locator(".collection-content")).toContainText(
    "WWWWWWWWWWWWWWWW",
  );
  await expect(
    page.getByRole("button", { name: "Davet", exact: true }),
  ).toBeVisible();
  assert.ok(
    await page
      .locator(".collection-content")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    "friend rows fit a phone even with long names",
  );
  await page.locator('[data-tab="leaderboard"]').tap();
  await expect(page.locator(".collection-content")).toContainText(
    "Herkes Tohum",
  );
  await page.getByRole("button", { name: "İkili BR", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "İkili BR", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Genel elemeler", exact: true }).tap();
  await expect(page.locator(".collection-content")).toContainText(
    "sunucunun doğruladığı",
  );
  mkdirSync("/tmp/archer-validation", { recursive: true });
  await page.screenshot({ path: "/tmp/archer-validation/community-phone.png" });
  assert.deepEqual(errors, []);
  await fetch(`${base}/api/profile/friends/remove`, {
    method: "POST",
    headers,
    body: JSON.stringify({ target: mine.profile.socialCode }),
  });
  console.log(
    `COMMUNITY_BROWSER_OK ${engine}: friends with consent, touch-safe dialogs, profile/rank panels, global leaderboards and optional identity buttons`,
  );
} catch (error) {
  const markup = await activePage
    ?.locator(".collection-content")
    .innerHTML()
    .catch(() => "unavailable");
  error.message += `\nCollection markup: ${markup}`;
  annotateFailure(error, "Community panels");
  console.error(error.message);
  throw error;
} finally {
  await browser.close();
}
