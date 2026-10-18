import { RULES } from "./config.js";

export const POWERUP_RULES = Object.freeze({
  duration: 15,
  respawn: 45,
  count: 2,
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
  p.buffTime > 0 ? POWERUPS[p.buffType]?.rate || 1 : 1;
export const arrowPower = (p) =>
  p.buffTime > 0 ? POWERUPS[p.buffType]?.damage || 1 : 1;

/** Fixed, public objectives. No client message can grant, refresh or move them. */
export class PowerupSystem {
  constructor(obstacles) {
    this.sites = ["haste", "power"].map((key, index) => {
      const sign = index ? 1 : -1;
      let point;
      for (let radius = 0; radius <= 16 && !point; radius += 2) {
        for (let i = 0; i < 16; i++) {
          const x = sign * 17 + Math.cos((i * Math.PI) / 8) * radius;
          const z = sign * 12 + Math.sin((i * Math.PI) / 8) * radius;
          if (
            Math.abs(x) > RULES.size / 2 - 4 ||
            Math.abs(z) > RULES.size / 2 - 4
          )
            continue;
          if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 2))
            continue;
          point = { x, z };
          break;
        }
      }
      return { id: key, key, ...(point || { x: sign * 4, z: 0 }), cooldown: 0 };
    });
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
    return (
      this.sites
        .filter((s) => s.cooldown <= 0)
        .sort(
          (a, b) =>
            Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
        )[0] || null
    );
  }
  snapshot() {
    return this.sites.map((s) => ({ ...s }));
  }
}
