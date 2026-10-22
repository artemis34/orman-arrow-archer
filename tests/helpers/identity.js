/** Exercise the settings entry point, keeping the shipped join flow covered. */
export async function setPlayerName(page, name) {
  await page.locator("#collection-open").click();
  await page.locator("#player-name").fill(name);
  await page.locator("#collection-close").click();
}
