const MODES = new Set(["onehand", "classic"]);

export const controlPreferenceKey = (touch) =>
  touch ? "wildbow-controls-touch" : "wildbow-controls-desktop";

/** Keep phone and mouse preferences independent, including hybrid computers.
 * The old initialization always wrote the shared key, so its `classic` value
 * cannot distinguish an explicit choice from the previous automatic default.
 * New per-device choices win; otherwise phones adopt one-hand and PCs retain
 * WASD/mouse. Existing legacy one-hand users naturally keep the same phone mode.
 */
export function controlModeFor({ touch = false, get = () => null } = {}) {
  let saved;
  try {
    saved = get(controlPreferenceKey(touch));
  } catch {
    // Storage can be denied in private or embedded browsers.
  }
  return MODES.has(saved) ? saved : touch ? "onehand" : "classic";
}

/** Return the selected mode even when the browser cannot persist preferences. */
export function saveControlMode({ touch = false, mode, set = () => {} } = {}) {
  if (!MODES.has(mode)) return null;
  for (const key of [controlPreferenceKey(touch), "wildbow-controls"]) {
    try {
      set(key, mode);
    } catch {
      // Playing and changing the current layout must not depend on persistence.
    }
  }
  return mode;
}
