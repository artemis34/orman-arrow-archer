import { RULES } from "./config.js";
import { segmentFraction } from "./spatial.js";
export const angleDelta = (a, b) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function clearShot(from, to, obstacles) {
  return !obstacles.some(
    (o) =>
      o.type !== "bush" &&
      segmentFraction(from.x, from.z, to.x, to.z, o.x, o.z, o.r) !== null,
  );
}
/** Nearest visible, unprotected opponent with actual line of sight. */
export function selectTarget(
  shooter,
  players,
  obstacles,
  { range = RULES.autoAimRange, angle = null, cone = Math.PI } = {},
) {
  let nearest = null,
    best = range;
  for (const p of players) {
    if (p.id === shooter.id || !p.alive || p.spawnShield > 0) continue;
    const distance = Math.hypot(p.x - shooter.x, p.z - shooter.z);
    if (distance > best || (p.hidden && distance >= 5)) continue;
    if (
      angle !== null &&
      Math.abs(
        angleDelta(Math.atan2(p.z - shooter.z, p.x - shooter.x), angle),
      ) > cone
    )
      continue;
    if (!clearShot(shooter, p, obstacles)) continue;
    nearest = p;
    best = distance;
  }
  return nearest;
}
/** Predict a short intercept; arrows still travel normally and can be dodged. */
export function aimedAngle(shooter, target, arrowSpeed, obstacles) {
  const rx = target.x - shooter.x,
    rz = target.z - shooter.z,
    vx = target.vx || 0,
    vz = target.vz || 0;
  const a = vx * vx + vz * vz - arrowSpeed * arrowSpeed,
    b = 2 * (rx * vx + rz * vz),
    c = rx * rx + rz * rz;
  let t = 0;
  if (Math.abs(a) < 1e-6) {
    if (b < 0) t = -c / b;
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0) {
      const roots = [
        (-b - Math.sqrt(d)) / (2 * a),
        (-b + Math.sqrt(d)) / (2 * a),
      ].filter((n) => n > 0);
      if (roots.length) t = Math.min(...roots);
    }
  }
  t = Math.min(0.65, Math.max(0, t));
  const point = { x: target.x + vx * t, z: target.z + vz * t };
  const aim = clearShot(shooter, point, obstacles) ? point : target;
  return Math.atan2(aim.z - shooter.z, aim.x - shooter.x);
}
