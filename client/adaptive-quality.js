/** Graphics steps for the default "Dengeli" setting, best first. */
export const QUALITY_STEPS = Object.freeze([
  Object.freeze({ pixelRatio: 1.5, shadows: true }),
  Object.freeze({ pixelRatio: 1.2, shadows: true }),
  Object.freeze({ pixelRatio: 1, shadows: false }),
]);

/** Lowers "Dengeli" graphics one step when a phone cannot hold its frame rate.
 *
 * Frame intervals are compared with what the display cadence expects. Two
 * consecutive windows whose 75th percentile is over `tolerance` times the
 * expected interval (e.g. under ~43 FPS when aiming for 60) lower the step.
 * It never raises quality mid-game, so it cannot oscillate; the caller keeps
 * the step for the next session.
 */
export class AdaptiveQuality {
  constructor(step = 0, { window = 90, tolerance = 1.4 } = {}) {
    this.step = Math.max(
      0,
      Math.min(QUALITY_STEPS.length - 1, Math.floor(step) || 0),
    );
    this.window = window;
    this.tolerance = tolerance;
    this.reset();
  }

  reset() {
    this.samples = [];
    this.slowWindows = 0;
    // Ignore the first window: shaders and textures warm up after joining.
    this.cooldown = 1;
  }

  /** Returns the new step when quality should drop, otherwise null. */
  observe(interval, expected) {
    if (this.step >= QUALITY_STEPS.length - 1) return null;
    // A stall (tab switch, alert) says nothing about steady rendering cost.
    if (!(interval > 0 && interval < 250 && expected > 0)) return null;
    this.samples.push(interval / expected);
    if (this.samples.length < this.window) return null;
    const sorted = this.samples.sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    this.samples = [];
    if (this.cooldown > 0) {
      this.cooldown--;
      return null;
    }
    this.slowWindows = p75 > this.tolerance ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 2) return null;
    this.step++;
    this.slowWindows = 0;
    // The change itself recompiles shaders once; do not judge that window.
    this.cooldown = 1;
    return this.step;
  }
}
