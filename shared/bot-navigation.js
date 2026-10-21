import { clamp, RULES } from "./config.js";

/** Steering recovery only: movement/collisions still run through advanceMovement. */
export class BotNavigation {
  tracks = new WeakMap();

  reset(player) {
    this.tracks.delete(player);
  }

  steer(player, goal, obstacles, time) {
    let track = this.tracks.get(player);
    if (!track) {
      track = { x: player.x, z: player.z, at: time, until: 0 };
      this.tracks.set(player, track);
    }
    const moved = Math.hypot(player.x - track.x, player.z - track.z);
    const trying = Math.hypot(player.input.x, player.input.z) > 0.2;
    const stuck = trying && time - track.at >= 1 && moved < 0.65;
    // Measure a full window: resetting on each short movement would mistake
    // back-and-forth oscillation in an obstacle's repulsion field for progress.
    if (time - track.at >= 1 || !trying) {
      track.x = player.x;
      track.z = player.z;
      track.at = time;
    }
    const edge = RULES.size / 2 - RULES.radius;
    const free = (x, z, distance) => {
      for (let step = 1; step <= 8; step++) {
        const travel = (distance * step) / 8;
        const px = player.x + x * travel,
          pz = player.z + z * travel;
        if (
          Math.abs(px) > edge ||
          Math.abs(pz) > edge ||
          obstacles.some(
            (o) =>
              o.type !== "bush" &&
              Math.hypot(px - o.x, pz - o.z) < o.r + RULES.radius + 0.02,
          )
        )
          return (distance * (step - 1)) / 8;
      }
      return distance;
    };
    const nextX = clamp(player.x + player.input.x, -edge, edge);
    const nextZ = clamp(player.z + player.input.z, -edge, edge);
    const blocked =
      trying && Math.hypot(nextX - player.x, nextZ - player.z) < 0.05;
    if (!stuck && !blocked && time >= track.until) return;
    if (time < track.until && free(track.xDir, track.zDir, 1) > 0.6) {
      player.input.x = track.xDir;
      player.input.z = track.zDir;
      return;
    }
    let gx = goal.x - player.x,
      gz = goal.z - player.z;
    const length = Math.hypot(gx, gz) || 1;
    gx /= length;
    gz /= length;
    const nearest = obstacles.reduce(
      (best, o) =>
        o.type !== "bush" &&
        (!best ||
          Math.hypot(o.x - player.x, o.z - player.z) - o.r <
            Math.hypot(best.x - player.x, best.z - player.z) - best.r)
          ? o
          : best,
      null,
    );
    const side =
      [...player.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 2 ? 1 : -1;
    let tx = -gz * side,
      tz = gx * side;
    if (nearest) {
      const ox = player.x - nearest.x,
        oz = player.z - nearest.z;
      const d = Math.hypot(ox, oz) || 1;
      tx = (-oz / d) * side;
      tz = (ox / d) * side;
    }
    let bestScore = -Infinity,
      direction;
    for (let n = 0; n < 16; n++) {
      const angle = (n * Math.PI) / 8;
      const x = Math.cos(angle),
        z = Math.sin(angle);
      const clearance = free(x, z, 3);
      const score =
        clearance + (x * gx + z * gz) * 0.25 + (x * tx + z * tz) * 0.6;
      if (score > bestScore) {
        bestScore = score;
        direction = { x, z };
      }
    }
    if (!direction) return;
    track.xDir = direction.x;
    track.zDir = direction.z;
    track.until = time + 0.9;
    track.x = player.x;
    track.z = player.z;
    track.at = time;
    player.input.x = direction.x;
    player.input.z = direction.z;
  }
}
