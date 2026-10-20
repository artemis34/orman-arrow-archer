/** Match rules run on the authority independently of transport and rendering. */
export const FORMATS = Object.freeze({
  arena: { name: "Serbest arena", capacity: 16, teams: 0, duration: 0 },
  round: { name: "Süreli arena", capacity: 16, teams: 0, duration: 240 },
  duel: {
    name: "Düello · 1v1",
    capacity: 2,
    teams: 0,
    duration: 120,
    duel: true,
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
export class BattleRoyale extends GameMode {
  constructor() {
    super();
    this.radius = 42;
  }
  get id() {
    return "br";
  }
  step(_world, dt) {
    this.radius = Math.max(6, this.radius - dt * 0.035);
  }
}
export const createMode = (key) =>
  formatKey(key) === "arena" ? new FreeForAll() : new RoundMode(key);
