/** Input helpers only: the authority still validates cooldowns and abilities. */
export const AUTO_HEAL_FRACTION = 0.35;
export const matchAllowsInput = (match) => !match || match.phase === "playing";
export const cooldownText = (seconds, tenths = false) =>
  !Number.isFinite(seconds) || seconds <= 0
    ? ""
    : tenths
      ? (Math.ceil(seconds * 10) / 10).toFixed(1)
      : String(Math.ceil(seconds));
export function automaticHealReady(me) {
  return !!(
    me?.alive &&
    me.maxHp > 0 &&
    me.hp > 0 &&
    me.hp <= me.maxHp * AUTO_HEAL_FRACTION &&
    me.healCd <= 0 &&
    !(me.levelGuard > 0)
  );
}
/** A target sits ahead of the thumb, in any direction; it never chases it outward. */
export class OverpullDash {
  constructor() {
    this.reset();
  }
  reset() {
    this.armed = true;
    this.target = null;
    this.previous = { x: 0, y: 0 };
  }
  move(dx, dy, radius, bounds) {
    if (![dx, dy, radius].every(Number.isFinite) || radius <= 0) return false;
    const length = Math.hypot(dx, dy);
    if (length < radius * 0.95) {
      this.reset();
      this.previous = { x: dx, y: dy };
      return false;
    }
    if (!this.armed) return false;
    const ux = dx / length,
      uy = dy / length;
    let distance = radius * 3.1;
    if (bounds) {
      if (ux > 0) distance = Math.min(distance, bounds.maxX / ux);
      if (ux < 0) distance = Math.min(distance, bounds.minX / ux);
      if (uy > 0) distance = Math.min(distance, bounds.maxY / uy);
      if (uy < 0) distance = Math.min(distance, bounds.minY / uy);
    }
    if (distance <= 0) {
      this.target = null;
      this.previous = { x: dx, y: dy };
      return false;
    }
    if (length > Math.min(radius * 1.05, distance * 0.5)) {
      const oldLength = this.target && Math.hypot(this.target.x, this.target.y);
      if (
        !this.target ||
        (dx * this.target.x + dy * this.target.y) / (length * oldLength) < 0.8
      )
        this.target = { x: ux * distance, y: uy * distance };
      const px = this.previous.x,
        py = this.previous.y,
        vx = dx - px,
        vy = dy - py;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((this.target.x - px) * vx + (this.target.y - py) * vy) /
            (vx * vx + vy * vy || 1),
        ),
      );
      if (
        Math.hypot(px + vx * t - this.target.x, py + vy * t - this.target.y) <=
        14
      ) {
        this.armed = false;
        this.target = null;
        this.previous = { x: dx, y: dy };
        return true;
      }
    }
    this.previous = { x: dx, y: dy };
    return false;
  }
}
export function joystickCard(dx, dy, radius) {
  if (![dx, dy, radius].every(Number.isFinite) || radius <= 0) return -1;
  if (Math.hypot(dx, dy) < Math.max(26, radius * 0.85)) return -1;
  if (dy > Math.abs(dx) * 0.8) return -1;
  if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx < 0 ? 0 : 2;
  return dy < 0 ? 1 : -1;
}
