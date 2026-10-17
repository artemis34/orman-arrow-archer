/** Render at display rate while physics stays at 30 Hz. Never affects authority. */
export function createPose(p) {
  return {
    x: p.x,
    z: p.z,
    speed: 0,
    weight: 0,
    phase: 0,
    alive: p.alive,
  };
}
export function updatePose(pose, target, dt) {
  if (dt <= 0) return pose;
  const distance = Math.hypot(target.x - pose.x, target.z - pose.z);
  if (!pose.alive || !target.alive || distance > 8) {
    pose.x = target.x;
    pose.z = target.z;
    pose.speed = 0;
    pose.weight = 0;
    pose.alive = target.alive;
    return pose;
  }
  const a = 1 - Math.exp(-24 * dt),
    dx = (target.x - pose.x) * a,
    dz = (target.z - pose.z) * a,
    travel = Math.hypot(dx, dz);
  pose.x += dx;
  pose.z += dz;
  const blend = 1 - Math.exp(-12 * dt);
  pose.speed += (travel / dt - pose.speed) * blend;
  const weight = target.dashTime > 0 ? 0 : Math.min(1, pose.speed / 5);
  pose.weight += (weight - pose.weight) * blend;
  pose.phase += travel * 1.7;
  return pose;
}
