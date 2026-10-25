/** Visual-only draw/release. A shot is confirmed by the authority's cooldown rise. */
export class BowPose {
  constructor(player = {}) {
    this.draw = 0;
    this.recoil = 0;
    this.release = 0;
    this.previousCd = player.shotCd || 0;
    this.period = Math.max(0.2, this.previousCd || 0.65);
  }
  update(player, dt, automatic = false) {
    const step = Math.max(0, Math.min(0.1, dt));
    if (!player.alive || player.levelGuard > 0) {
      this.draw = this.recoil = this.release = 0;
      this.previousCd = player.shotCd || 0;
      return this;
    }
    const cd = player.shotCd || 0;
    const fired = cd > this.previousCd + 0.08;
    this.previousCd = cd;
    this.recoil *= Math.exp(-step * 22);
    this.release = Math.max(0, this.release - step);
    if (fired) {
      this.period = cd;
      this.recoil = 1;
      this.release = 0.09;
      this.draw = Math.max(this.draw, 0.55);
    }
    const autoDraw =
      automatic && this.release === 0
        ? 0.55 * Math.max(0, Math.min(1, (1 - cd / this.period) * 1.25))
        : 0;
    const desired = player.charge > 0 ? player.charge : autoDraw;
    this.draw += (desired - this.draw) * (1 - Math.exp(-step * 18));
    if (Math.abs(desired - this.draw) < 0.001) this.draw = desired;
    if (this.recoil < 0.001) this.recoil = 0;
    return this;
  }
}
