/** Display pacing only. Simulation and network input retain their own clocks.
 *
 * Frames are drawn on every Nth display refresh, never on a free-running
 * deadline. A deadline (e.g. "60 FPS") on a 90 Hz or 144 Hz screen holds
 * frames for one, then two refreshes, which reads as judder while walking.
 * Choosing a whole divisor keeps every drawn frame evenly spaced:
 * 60/75/90 Hz draw every refresh, 120/144 Hz every second one, 240 Hz every
 * fourth. `rate` is a soft target: the divisor never drops below it.
 */
const SAMPLES = 15;

export class RenderCadence {
  constructor() {
    this.reset();
  }

  reset() {
    this.last = null;
    this.deltas = [];
    this.phase = 0;
    this.rate = 0;
  }

  /** Median refresh interval in milliseconds, or null while still measuring. */
  refreshInterval() {
    if (this.deltas.length < 3) return null;
    const sorted = [...this.deltas].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  divisor(rate) {
    const interval = this.refreshInterval();
    if (!interval) return 1;
    const refresh = 1000 / interval;
    // 1.5 (90 Hz at a 60 target) keeps every frame; 2.4 (144 Hz) halves it.
    return Math.max(1, Math.floor(refresh / rate + 0.2));
  }

  due(now, rate = 60) {
    if (!Number.isFinite(now) || !Number.isFinite(rate) || rate <= 0)
      return false;
    if (this.last !== null) {
      const delta = now - this.last;
      if (delta < 0) {
        // A backwards clock (resume, test harness) restarts measurement.
        this.reset();
      } else if (delta >= 3 && delta < 100) {
        this.deltas.push(delta);
        if (this.deltas.length > SAMPLES) this.deltas.shift();
      }
    }
    this.last = now;
    if (rate !== this.rate) {
      // A mode change draws immediately and starts a fresh phase.
      this.rate = rate;
      this.phase = 0;
      return true;
    }
    this.phase = (this.phase + 1) % this.divisor(rate);
    return this.phase === 0;
  }
}
