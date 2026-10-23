/** One announced, contestable objective with a bounded reward. */
export class ForestShrine {
  constructor() {
    this.reset();
  }
  reset(time = 0) {
    this.nextAt = time + 60;
    this.until = 0;
    this.owner = null;
    this.progress = 0;
    this.active = false;
    this.contested = false;
  }
  step(world, dt) {
    if (world.mode.rules?.progression === false) return;
    if (!this.active && world.time >= this.nextAt) {
      this.active = true;
      this.until = world.time + 25;
      this.owner = null;
      this.progress = 0;
      world.events.push({ type: "shrineStart", x: 0, z: 0 });
    }
    if (!this.active) return;
    const nearby = [...world.players.values()].filter(
      (p) =>
        p.alive &&
        p.levelGuard <= 0 &&
        p.spawnShield <= 0 &&
        Math.hypot(p.x, p.z) < 3.2,
    );
    const sides = new Set(nearby.map((p) => p.team ?? p.id));
    this.contested = sides.size > 1;
    if (sides.size === 1) {
      const side = [...sides][0];
      if (this.owner !== side) {
        this.owner = side;
        this.progress = 0;
      }
      this.progress += dt;
    } else if (!sides.size)
      this.progress = Math.max(0, this.progress - dt * 0.5);
    if (this.progress >= 4 && nearby.length) {
      for (const p of nearby) {
        world.gain(p, 24);
        p.matchPoints += 2;
        p.objectives++;
      }
      const team = nearby[0].team;
      if (team != null && world.mode.teamScores)
        world.mode.teamScores[team] += 2;
      world.events.push({
        type: "shrineClaim",
        x: 0,
        z: 0,
        owner: nearby[0].id,
        team,
      });
      this.active = false;
      this.nextAt = world.time + 75;
    } else if (world.time >= this.until) {
      this.active = false;
      this.nextAt = world.time + 60;
    }
  }
  snapshot(time) {
    return {
      x: 0,
      z: 0,
      active: this.active,
      contested: this.contested,
      owner: this.owner,
      progress: Math.round(this.progress * 10) / 10,
      remaining: Math.ceil(
        Math.max(0, (this.active ? this.until : this.nextAt) - time),
      ),
    };
  }
}
