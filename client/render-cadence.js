/** Display pacing only. Simulation and network input retain their own clocks. */
export class RenderCadence {
  constructor() {
    this.reset();
  }

  reset() {
    this.rate = 0;
    this.nextAt = null;
    this.observedAt = null;
  }

  due(now, rate = 60) {
    if (!Number.isFinite(now) || !Number.isFinite(rate) || rate <= 0)
      return false;
    const interval = 1000 / rate;
    if (this.nextAt === null || this.rate !== rate || now < this.observedAt) {
      this.rate = rate;
      this.observedAt = now;
      this.nextAt = now + interval;
      return true;
    }
    this.observedAt = now;
    const late = now - this.nextAt;
    // RAF timestamps may be rounded down to 1–2 ms precision. Accept that
    // quantization plus floating-point drift without skipping a display frame;
    // cap the allowance at one eighth of a slot for faster target rates.
    const tolerance = Math.min(2.01, interval * 0.125);
    if (late < -tolerance) return false;
    // Preserve phase through ordinary refresh jitter instead of resetting the
    // deadline to now. After a missed whole slot, discard that debt: never
    // submit several GPU frames to catch up after a stall or suspension.
    this.nextAt = late >= interval ? now + interval : this.nextAt + interval;
    return true;
  }
}
