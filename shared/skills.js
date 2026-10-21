import { RULES } from "./config.js";
import { clearShot, selectTarget } from "./aim.js";
/** All secondary effects are authoritative, bounded, and never recursively hit. */
export function applyArrowImpact(world, arrow, target, distance = 0) {
  const damage =
    arrow.damage *
    (arrow.longshot && distance >= RULES.longshotRange
      ? 1 + RULES.longshotBonus
      : 1);
  const critical =
    target.alive &&
    target.spawnShield <= 0 &&
    target.levelGuard <= 0 &&
    world.combatRandom() < RULES.criticalChance;
  const dealt = world.damage(
    target,
    damage * (critical ? 1 + RULES.criticalBonus : 1),
    arrow.owner,
    "impact",
    critical,
  );
  if (!dealt) return false;
  const leechOwner = world.players.get(arrow.owner);
  if (leechOwner?.alive && leechOwner.upgrades.lifesteal) {
    let window = world.leech.get(leechOwner);
    if (!window || world.time - window.at >= 1) {
      window = { at: world.time, healed: 0 };
      world.leech.set(leechOwner, window);
    }
    const healed = Math.max(
      0,
      Math.min(
        leechOwner.maxHp - leechOwner.hp,
        dealt * RULES.lifestealRatio,
        RULES.lifestealHitCap,
        RULES.lifestealSecondCap - window.healed,
      ),
    );
    if (healed > 0) {
      leechOwner.hp += healed;
      window.healed += healed;
      world.events.push({
        type: "leech",
        owner: arrow.owner,
        x: leechOwner.x,
        z: leechOwner.z,
        amount: healed,
      });
    }
  }
  target.hidden = false;
  // Level-up protection cancels existing attacks as well as new shots.
  if (arrow.cancelled || world.players.get(arrow.owner)?.levelGuard > 0)
    return true;
  if (arrow.poison && target.alive) {
    if (target.poison <= 0 || arrow.poisonDps >= target.poisonDps) {
      target.poisonDps = arrow.poisonDps;
      target.poisonOwner = arrow.owner;
    }
    target.poison = RULES.poisonDuration;
  }
  if (arrow.frost && target.alive && target.slowImmunity <= 0) {
    target.slowTime = RULES.frostDuration;
    target.slowImmunity = RULES.frostImmunity;
    world.events.push({
      type: "frost",
      x: target.x,
      z: target.z,
      target: target.id,
      owner: arrow.owner,
    });
  }
  const owner = world.players.get(arrow.owner);
  if (arrow.blast && owner?.alive && owner.blastCd <= 0) {
    owner.blastCd = RULES.blastCooldown;
    world.events.push({
      type: "blast",
      x: target.x,
      z: target.z,
      target: target.id,
      owner: arrow.owner,
    });
    for (const other of world.grid.query(
      target.x,
      target.z,
      RULES.blastRadius,
    )) {
      if (
        other.id === target.id ||
        other.id === arrow.owner ||
        !other.alive ||
        other.dashTime > 0 ||
        Math.hypot(other.x - target.x, other.z - target.z) >
          RULES.blastRadius ||
        !clearShot(target, other, world.obstacles)
      )
        continue;
      world.damage(
        other,
        RULES.blastDamage * (owner.bot ? RULES.botDamageScale : 1),
        arrow.owner,
        "blast",
      );
    }
  }
  return true;
}
export function redirectRicochet(world, arrow, impact) {
  if (!arrow.ricochet || arrow.cancelled) return false;
  const owner = world.players.get(arrow.owner);
  if (!owner?.alive || owner.levelGuard > 0) return false;
  const candidates = [
    ...world.grid.query(impact.x, impact.z, RULES.ricochetRange),
  ].filter((p) => !arrow.hits.has(p.id) && world.mode.canDamage(owner, p));
  const next = selectTarget(
    { ...impact, id: arrow.owner, team: owner.team },
    candidates,
    world.obstacles,
    { range: RULES.ricochetRange, priority: "nearest", preferredId: null },
  );
  if (!next) return false;
  const angle = Math.atan2(next.z - impact.z, next.x - impact.x),
    speed = Math.hypot(arrow.vx, arrow.vz);
  arrow.x = impact.x + Math.cos(angle) * 0.85;
  arrow.z = impact.z + Math.sin(angle) * 0.85;
  arrow.vx = Math.cos(angle) * speed;
  arrow.vz = Math.sin(angle) * speed;
  arrow.damage *= RULES.ricochetScale;
  arrow.poisonDps *= RULES.ricochetScale;
  arrow.ricochet--;
  arrow.life = Math.max(arrow.life, 0.28);
  world.events.push({
    type: "ricochet",
    x: impact.x,
    z: impact.z,
    owner: arrow.owner,
    target: impact.id,
  });
  return true;
}
