/** Match rules run on the authority independently of transport and rendering. */
export const FORMATS = Object.freeze({
  arena: { name: "Serbest arena", capacity: 16, teams: 0, duration: 0 },
  br: {
    name: "Battle Royale",
    capacity: 16,
    teams: 0,
    duration: 210,
    battleRoyale: true,
  },
  round: { name: "Süreli arena", capacity: 16, teams: 0, duration: 240 },
  duel: {
    name: "Düello · 1v1",
    capacity: 2,
    teams: 0,
    duration: 120,
    duel: true,
    progression: true,
  },
  ranked: {
    name: "Ranked · Orman düellosu",
    capacity: 2,
    teams: 0,
    duration: 120,
    duel: true,
    ranked: true,
    progression: false,
  },
  t2: { name: "Takım · 2v2", capacity: 4, teams: 2, duration: 240 },
  t4: { name: "Takım · 4v4", capacity: 8, teams: 2, duration: 240 },
  t8: { name: "Takım · 8v8", capacity: 16, teams: 2, duration: 240 },
  squads: { name: "4 takım × 4 kişi", capacity: 16, teams: 4, duration: 240 },
  duos: { name: "8 takım × 2 kişi", capacity: 16, teams: 8, duration: 240 },
});
export const TEAMS = Object.freeze([
  { name: "Kırmızı", color: "#f58b83", symbol: "◆" },
  { name: "Mavi", color: "#82c9ff", symbol: "●" },
  { name: "Yeşil", color: "#a9e69a", symbol: "▲" },
  { name: "Altın", color: "#f5d27c", symbol: "■" },
  { name: "Mor", color: "#c4a3ff", symbol: "✦" },
  { name: "Turuncu", color: "#ffb579", symbol: "⬟" },
  { name: "Turkuaz", color: "#78e3d7", symbol: "◇" },
  { name: "Pembe", color: "#f5a4d3", symbol: "✚" },
]);
export const formatKey = (value) =>
  typeof value === "string" && Object.hasOwn(FORMATS, value) ? value : "arena";
export const opponents = (a, b) =>
  a.id !== b.id && (a.team == null || b.team == null || a.team !== b.team);
export class GameMode {
  get id() {
    return "arena";
  }
  canDamage(a, b) {
    return opponents(a, b);
  }
  onElimination(_world, _attacker, _target) {}
  step(_world, _dt) {}
  get combat() {
    return true;
  }
}
export class FreeForAll extends GameMode {}
export class RoundMode extends GameMode {
  constructor(key = "round", { duration } = {}) {
    super();
    this.key = formatKey(key);
    this.rules = FORMATS[this.key];
    this.duration = duration ?? this.rules.duration;
    this.phase = "waiting";
    this.round = 1;
    this.endAt = 0;
    this.restartAt = 0;
    this.votes = new Set();
    this.results = null;
    this.teamScores = Array(this.rules.teams).fill(0);
  }
  get id() {
    return this.key;
  }
  get combat() {
    return this.phase === "playing";
  }
  canDamage(a, b) {
    return this.combat && opponents(a, b);
  }
  assign(world, player, party = "") {
    if (!this.rules.teams) {
      player.team = null;
      return;
    }
    const size = this.rules.capacity / this.rules.teams;
    const members = [...world.players.values()].filter(
      (p) => p.id !== player.id,
    );
    const counts = this.teamScores.map(
      (_, i) => members.filter((p) => p.team === i).length,
    );
    const friend =
      party &&
      members.find(
        (p) =>
          !p.bot &&
          p.party === party &&
          members.filter((m) => !m.bot && m.team === p.team).length < size,
      );
    if (friend && counts[friend.team] >= size) {
      const replacement = members.find((p) => p.bot && p.team === friend.team);
      const spare = counts.findIndex((n, id) => n < size && id !== friend.team);
      if (replacement && spare >= 0) {
        counts[replacement.team]--;
        replacement.team = spare;
        counts[spare]++;
        Object.assign(replacement, world.spawnPoint(5, spare));
      }
    }
    player.team = friend ? friend.team : counts.indexOf(Math.min(...counts));
    player.party = party;
  }
  onElimination(world, attacker, target) {
    if (attacker && opponents(attacker, target)) {
      attacker.matchPoints += 3;
      if (attacker.team != null) this.teamScores[attacker.team] += 3;
    }
    for (const [id, at] of target.contributors || []) {
      const p = world.players.get(id);
      if (!p || p === attacker || !opponents(p, target) || world.time - at > 8)
        continue;
      p.assists++;
      p.matchPoints++;
      if (p.team != null) this.teamScores[p.team]++;
    }
    target.contributors?.clear();
  }
  finish(world) {
    this.phase = "results";
    this.restartAt = world.time + 12;
    this.results = [...world.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        bot: p.bot,
        kills: p.kills,
        assists: p.assists,
        points: p.matchPoints,
      }))
      .sort(
        (a, b) =>
          b.points - a.points || b.kills - a.kills || a.id.localeCompare(b.id),
      );
    for (const p of world.players.values()) {
      p.charge = p.vx = p.vz = 0;
      p.input.x = p.input.z = 0;
    }
    while (world.arrows.active.length) world.arrows.release(0);
    world.events.push({ type: "roundEnd", round: this.round });
  }
  vote(world, id) {
    if (this.phase !== "results" || !world.players.has(id)) return false;
    this.votes.add(id);
    const humans = [...world.players.values()].filter((p) => !p.bot);
    if (humans.length && humans.every((p) => this.votes.has(p.id)))
      this.restartAt = world.time;
    return true;
  }
  step(world) {
    if (this.rules.duel && this.phase === "playing" && world.players.size < 2) {
      this.phase = "waiting";
      world.resetRound();
    }
    if (this.phase === "waiting" && world.players.size >= 2) {
      world.resetRound();
      this.phase = "playing";
      this.endAt = world.time + this.duration;
    } else if (this.phase === "playing" && world.time >= this.endAt)
      this.finish(world);
    else if (this.phase === "results" && world.time >= this.restartAt) {
      this.round++;
      this.votes.clear();
      this.results = null;
      this.forfeit = null;
      this.teamScores.fill(0);
      this.phase = "waiting";
      world.resetRound();
    }
  }
  snapshot(world) {
    return {
      format: this.key,
      name: this.rules.name,
      round: this.round,
      phase: this.phase,
      remaining: Math.ceil(
        Math.max(
          0,
          (this.phase === "results" ? this.restartAt : this.endAt) - world.time,
        ),
      ),
      teams: this.teamScores.map((score, id) => ({ id, ...TEAMS[id], score })),
      results: this.results,
      votes: [...this.votes],
      capacity: this.rules.capacity,
    };
  }
}
export class TeamDeathmatch extends RoundMode {
  constructor(key = "t4", options) {
    super(key, options);
  }
}
/** Solo elimination. Only this ruleset disables respawns and applies the storm.
 * Zone state is optional match metadata, understood by web or native clients.
 * The initial circle covers every corner of the existing 84 × 84 arena.
 */
export class BattleRoyale extends RoundMode {
  constructor({ countdown = 12 } = {}) {
    super("br");
    this.countdown = countdown;
    this.startAt = 0;
    this.startedAt = 0;
    this.nextStormAt = 0;
    this.eliminations = new Map();
    this.winnerId = null;
    this.zone = {
      x: 0,
      z: 0,
      radius: 60,
      damage: 5,
      shrinking: false,
      remaining: 20,
    };
  }
  get acceptsPlayers() {
    return this.phase === "waiting";
  }
  get canRespawn() {
    return this.phase === "waiting";
  }
  onElimination(world, attacker, target) {
    super.onElimination(world, attacker, target);
    this.eliminations.set(target.id, world.time);
  }
  updateZone(world) {
    const age = world.time - this.startedAt;
    // 20 seconds to gather, then five smooth 35-second contractions.
    const radii = [60, 42, 28, 16, 7, 0];
    const progress = Math.max(0, age - 20) / 35;
    const stage = Math.min(4, Math.floor(progress));
    const fraction = Math.min(1, progress - stage);
    this.zone.radius =
      radii[stage] + (radii[stage + 1] - radii[stage]) * fraction;
    this.zone.damage = [5, 8, 12, 18, 30][stage];
    this.zone.shrinking = age >= 20;
    this.zone.remaining = Math.ceil(Math.max(0, 20 - age));
  }
  finish(world) {
    const alive = [...world.players.values()].filter((p) => p.alive);
    this.winnerId = alive.length === 1 ? alive[0].id : null;
    super.finish(world);
    this.results.sort((a, b) => {
      if (a.id === this.winnerId) return -1;
      if (b.id === this.winnerId) return 1;
      return (
        (this.eliminations.get(b.id) ?? Infinity) -
          (this.eliminations.get(a.id) ?? Infinity) || b.kills - a.kills
      );
    });
    this.results.forEach((row, i) => {
      row.placement = i + 1;
    });
  }
  step(world) {
    if (this.phase === "waiting") {
      if (world.players.size < 2) {
        this.startAt = 0;
        return;
      }
      this.startAt ||= world.time + this.countdown;
      const humans = [...world.players.values()].filter((p) => !p.bot).length;
      if (world.time < this.startAt && humans < this.rules.capacity) return;
      world.resetRound();
      this.eliminations.clear();
      this.winnerId = null;
      this.phase = "playing";
      this.startedAt = world.time;
      this.endAt = world.time + this.duration;
      this.nextStormAt = world.time + 1;
    } else if (this.phase === "playing") {
      const alive = [...world.players.values()].filter((p) => p.alive);
      if (alive.length <= 1) {
        this.finish(world);
        return;
      }
      this.updateZone(world);
      if (world.time >= this.nextStormAt) {
        this.nextStormAt = world.time + 1;
        for (const p of alive)
          if (
            Math.hypot(p.x - this.zone.x, p.z - this.zone.z) >= this.zone.radius
          )
            world.damage(p, this.zone.damage, null, "storm");
        if ([...world.players.values()].filter((p) => p.alive).length <= 1)
          this.finish(world);
      }
    } else if (world.time >= this.restartAt) {
      this.round++;
      this.votes.clear();
      this.results = null;
      this.phase = "waiting";
      this.startAt = 0;
      this.winnerId = null;
      this.zone.radius = 60;
      this.zone.shrinking = false;
      this.zone.damage = 5;
      this.zone.remaining = 20;
      // Departed seats may be replenished only between rounds.
      const humans = [...world.players.values()].filter((p) => !p.bot).length;
      world.setBotCount(Math.max(0, this.rules.capacity - humans));
      world.resetRound();
    }
  }
  snapshot(world) {
    const state = super.snapshot(world);
    if (this.phase === "waiting")
      state.remaining = Math.ceil(Math.max(0, this.startAt - world.time));
    return {
      ...state,
      zone: { ...this.zone },
      winnerId: this.winnerId,
      survivors: [...world.players.values()].filter((p) => p.alive).length,
    };
  }
}
export const createMode = (key) =>
  formatKey(key) === "arena"
    ? new FreeForAll()
    : key === "br"
      ? new BattleRoyale()
      : new RoundMode(key);
