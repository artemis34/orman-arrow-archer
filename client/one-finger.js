/** Input helpers only: the authority still validates cooldowns and abilities. */
export const AUTO_HEAL_FRACTION = 0.35;

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

/** One pull is one dodge. Returning inside the pad rearms the next pull. */
export class OverpullDash {
  constructor() {
    this.reset();
  }
  reset() {
    this.armed = true;
  }
  move(distance, radius) {
    if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0)
      return false;
    if (distance < radius * 0.95) this.armed = true;
    if (!this.armed || distance < radius * 1.85) return false;
    this.armed = false;
    return true;
  }
}

/** Three directions match the cards: left, up, right; down/centre cancels. */
export function joystickCard(dx, dy, radius) {
  if (![dx, dy, radius].every(Number.isFinite) || radius <= 0) return -1;
  if (Math.hypot(dx, dy) < Math.max(26, radius * 0.85)) return -1;
  if (dy > Math.abs(dx) * 0.8) return -1;
  if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx < 0 ? 0 : 2;
  return dy < 0 ? 1 : -1;
}
