import { RULES } from "./config.js";

export const POWERUP_RULES = Object.freeze({
  duration: 15,
  respawn: 45,
  count: 2,
  approachClearance: 2.1,
  canopyRadiusScale: 1.85,
  canopyHeightScale: 5.1,
  cameraSlope: 0.73,
});
export const POWERUPS = Object.freeze({
  haste: {
    name: "Seri yay",
    icon: "ϟ",
    color: "#82dfff",
    description: "%30 atış hızı",
    rate: 1.3,
  },
  power: {
    name: "Avcı kudreti",
    icon: "↑",
    color: "#ffab83",
    description: "%20 ok hasarı",
    damage: 1.2,
  },
});
export const attackRate = (p) =>
  (p.buffTime > 0 ? POWERUPS[p.buffType]?.rate || 1 : 1) *
  (p.rhythmTime > 0 ? 1.15 : 1);
export const arrowPower = (p) =>
  p.buffTime > 0 ? POWERUPS[p.buffType]?.damage || 1 : 1;

const pointSegmentDistance = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax,
    dz = bz - az,
    lengthSq = dx * dx + dz * dz,
    t = lengthSq
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq))
      : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};

/** Public objectives need a clear approach AND a readable ground footprint.
 * Tree collisions describe the trunk, but the visual crown is wider and projects
 * behind it in our +z, inclined camera. Reserve that projected capsule as well.
 */
export function powerupSpotClear(point, obstacles, includeCanopy = true) {
  if (
    Math.abs(point.x) > RULES.size / 2 - 4 ||
    Math.abs(point.z) > RULES.size / 2 - 4
  )
    return false;
  for (const o of obstacles) {
    if (
      Math.hypot(o.x - point.x, o.z - point.z) <
      o.r + POWERUP_RULES.approachClearance
    )
      return false;
    if (includeCanopy && o.type === "tree") {
      const back =
        o.z - o.r * POWERUP_RULES.canopyHeightScale * POWERUP_RULES.cameraSlope;
      if (
        pointSegmentDistance(point.x, point.z, o.x, o.z, o.x, back) <
        o.r * POWERUP_RULES.canopyRadiusScale + 1.1
      )
        return false;
    }
  }
  return true;
}

function findSite(obstacles, anchor, existing) {
  const fits = (p, canopy = true) =>
    powerupSpotClear(p, obstacles, canopy) &&
    existing.every((s) => Math.hypot(s.x - p.x, s.z - p.z) >= 8);
  for (let radius = 0; radius <= 22; radius += 2) {
    for (let i = 0; i < (radius ? 24 : 1); i++) {
      const p = {
        x: anchor.x + Math.cos((i * Math.PI) / 12) * radius,
        z: anchor.z + Math.sin((i * Math.PI) / 12) * radius,
      };
      if (fits(p)) return p;
    }
  }
  // Bounded fallback for custom maps. Never put a pickup inside collision cover.
  // The small foreground badge remains readable if dense foliage leaves no
  // entirely canopy-free clearing; impossible fully blocked maps get no site.
  for (const canopy of [true, false])
    for (let z = -36; z <= 36; z += 2)
      for (let x = -36; x <= 36; x += 2) {
        const p = { x, z };
        if (fits(p, canopy)) return p;
      }
  return null;
}

/** Fixed, public objectives. No client message can grant, refresh or move them. */
export class PowerupSystem {
  constructor(obstacles, { duel = false } = {}) {
    this.sites = [];
    const keys = ["haste", "power"];
    if (duel) {
      // Both neutral objectives are equally far from the left and right spawns.
      for (const z of [8, 6, 10, 14, 18, 22, 26, 30]) {
        const pair = [
          { x: 0, z: -z },
          { x: 0, z },
        ];
        if (!pair.every((p) => powerupSpotClear(p, obstacles))) continue;
        this.sites = pair.map((p, i) => ({
          id: keys[i],
          key: keys[i],
          ...p,
          cooldown: 0,
        }));
        break;
      }
    } else
      for (let i = 0; i < keys.length; i++) {
        const sign = i ? 1 : -1;
        const point = findSite(
          obstacles,
          { x: sign * 17, z: sign * 12 },
          this.sites,
        );
        if (point)
          this.sites.push({ id: keys[i], key: keys[i], ...point, cooldown: 0 });
      }
  }
  tick(dt, players) {
    for (const site of this.sites)
      site.cooldown = Math.max(0, site.cooldown - dt);
    for (const p of players) {
      p.buffTime = p.alive ? Math.max(0, (p.buffTime || 0) - dt) : 0;
      if (!p.buffTime) p.buffType = null;
    }
  }
  collect(p, events) {
    if (!p.alive || p.levelGuard > 0 || p.spawnShield > 0 || p.buffTime > 0)
      return false;
    const site = this.sites.find(
      (s) => s.cooldown <= 0 && Math.hypot(s.x - p.x, s.z - p.z) <= 1.3,
    );
    if (!site) return false;
    p.buffType = site.key;
    p.buffTime = POWERUP_RULES.duration;
    site.cooldown = POWERUP_RULES.respawn;
    events.push({
      type: "buff",
      owner: p.id,
      key: site.key,
      x: site.x,
      z: site.z,
    });
    return true;
  }
  goal(p) {
    if (p.buffTime > 0) return null;
    let nearest = null,
      distance = Infinity;
    for (const s of this.sites) {
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (s.cooldown <= 0 && d < distance) {
        nearest = s;
        distance = d;
      }
    }
    return nearest;
  }
  snapshot() {
    return this.sites.map((s) => ({ ...s }));
  }
}
