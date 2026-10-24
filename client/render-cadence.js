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
    // RAF timestamps can fall a fraction of a millisecond before the ideal
    // deadline. Without this tolerance a 60 Hz display can alternate 16/33 ms.
    const tolerance = Math.min(0.5, interval * 0.03);
    if (late < -tolerance) return false;
    // Preserve phase through ordinary refresh jitter instead of resetting the
    // deadline to now. After a missed whole slot, discard that debt: never
    // submit several GPU frames to catch up after a stall or suspension.
    this.nextAt = late >= interval ? now + interval : this.nextAt + interval;
    return true;
  }
}
