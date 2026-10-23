/** Controls are a persistent preference in settings, outside the join flow. */
export async function selectControlMode(page, mode, { touch = true } = {}) {
  const activate = (selector) =>
    page.locator(selector)[touch ? "tap" : "click"]();
  await activate("#collection-open");
  await activate(`[data-tab="settings"]`);
  await activate(
    mode === "classic" ? "#classic-controls" : "#onehand-controls",
  );
  await activate("#collection-close");
}
