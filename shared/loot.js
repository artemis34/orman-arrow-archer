import { RULES, clamp } from "./config.js";

/** Separate RNG/pool: drops never move terrain or consume rare XP slots. */
export class LootDrops {
  constructor(seed = 7821, size = RULES.size) {
    this.size = size;
    this.seed = seed ^ 0x471ace;
    this.nextAt = 45;
    this.nextId = 0;
    this.drops = [];
  }
  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  interval(world) {
    const players = [...world.players.values()];
    const population = players.reduce((n, p) => n + (p.bot ? 0.25 : 1), 0);
    return clamp(
      90 / (Math.sqrt(Math.max(1, population)) * (this.size / 84)),
      25,
      120,
    );
  }
  spawn(world) {
    const cell = this.nextId++ % 9,
      edge = this.size / 2 - 5;
    let best = null,
      score = -Infinity;
    for (let n = 0; n < 48; n++) {
      const x =
        n < 32
          ? ((((cell % 3) + this.random()) / 3) * 2 - 1) * edge
          : (this.random() * 2 - 1) * edge;
      const z =
        n < 32
          ? (((Math.floor(cell / 3) + this.random()) / 3) * 2 - 1) * edge
          : (this.random() * 2 - 1) * edge;
      if (
        world.obstacles.some(
          (o) => o.type !== "bush" && Math.hypot(o.x - x, o.z - z) < o.r + 2.3,
        ) ||
        this.drops.some((o) => Math.hypot(o.x - x, o.z - z) < 12)
      )
        continue;
      const distance = Math.min(
        20,
        ...[...world.players.values()]
          .filter((p) => p.alive)
          .map((p) => Math.hypot(p.x - x, p.z - z)),
      );
      if (distance > score) {
        score = distance;
        best = { x, z };
      }
      if (distance >= 10 && n < 32) break;
    }
    if (!best) return;
    const drop = {
      id: `loot-${this.nextId}`,
      ...best,
      landAt: world.time + 6,
      expiresAt: world.time + 51,
      landed: false,
    };
    this.drops.push(drop);
    world.events.push({ type: "lootDrop", x: drop.x, z: drop.z });
  }
  tick(world) {
    if (world.mode.rules?.duel) return;
    if (world.time >= this.nextAt) {
      if (this.drops.length < 3 && world.players.size) this.spawn(world);
      this.nextAt =
        world.time + this.interval(world) * (0.85 + this.random() * 0.3);
    }
    for (let n = this.drops.length - 1; n >= 0; n--) {
      const d = this.drops[n];
      if (world.time >= d.expiresAt) {
        this.drops.splice(n, 1);
        continue;
      }
      if (world.time < d.landAt) continue;
      d.landed = true;
      const candidates = [...world.players.values()]
        .filter(
          (p) =>
            p.alive &&
            p.levelGuard <= 0 &&
            p.spawnShield <= 0 &&
            Math.hypot(p.x - d.x, p.z - d.z) < 1.25,
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - d.x, a.z - d.z) -
              Math.hypot(b.x - d.x, b.z - d.z) || a.id.localeCompare(b.id),
        );
      const p = candidates[0];
      if (!p) continue;
      world.gain(p, p.level * 55 - p.xp);
      world.events.push({
        type: "lootClaim",
        owner: p.id,
        x: d.x,
        z: d.z,
        level: p.level,
      });
      this.drops.splice(n, 1);
    }
  }
  snapshot() {
    return this.drops.map(({ id, x, z, landAt, expiresAt, landed }) => ({
      id,
      x,
      z,
      landAt,
      expiresAt,
      landed,
    }));
  }
}
