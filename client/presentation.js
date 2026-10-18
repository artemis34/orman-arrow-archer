/** Render at display rate while physics stays at 30 Hz. Never affects authority. */
export function createPose(p) {
  return {
    x: p.x,
    z: p.z,
    speed: 0,
    weight: 0,
    phase: 0,
    facing: p.angle || 0,
    moveAngle: p.angle || 0,
    turn: 0,
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
    pose.phase = 0;
    pose.facing = target.angle || 0;
    pose.moveAngle = pose.facing;
    pose.turn = 0;
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
  const turn = Math.atan2(
    Math.sin((target.angle || 0) - pose.facing),
    Math.cos((target.angle || 0) - pose.facing),
  );
  pose.facing += turn * (1 - Math.exp(-16 * dt));
  pose.turn += (Math.max(-1, Math.min(1, turn * 2)) - pose.turn) * blend;
  if (travel > 0.0001) {
    const heading = Math.atan2(dz, dx);
    const delta = Math.atan2(
      Math.sin(heading - pose.moveAngle),
      Math.cos(heading - pose.moveAngle),
    );
    pose.moveAngle += delta * (1 - Math.exp(-18 * dt));
  }
  pose.speed += (travel / dt - pose.speed) * blend;
  const weight = target.dashTime > 0 ? 0 : Math.min(1, pose.speed / 5);
  pose.weight += (weight - pose.weight) * blend;
  pose.phase += travel * 3.6;
  return pose;
}
