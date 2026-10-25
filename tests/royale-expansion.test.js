import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import {
  BattleRoyale,
  createMode,
  FORMATS,
  formatKey,
} from "../shared/modes.js";
import { SnapshotEncoder, SnapshotDecoder } from "../shared/protocol.js";
for (const key of ["br", "brduo", "brranked", "brduoranked"])
  test(`${key} fills exactly 32 seats, including all 16 pairs`, () => {
    const w = new World({ bots: 0, mode: createMode(key) });
    w.setBotCount(31);
    w.addPlayer("human");
    assert.equal(w.players.size, 32);
    assert.equal([...w.players.values()].filter((p) => p.bot).length, 31);
    if (FORMATS[formatKey(key)].teams)
      for (let team = 0; team < 16; team++)
        assert.equal(
          [...w.players.values()].filter((p) => p.team === team).length,
          2,
        );
    const decoded = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(w.snapshot("human")),
    );
    assert.equal(decoded.match.capacity, 32);
    assert.equal(decoded.roster.length, 32);
  });
function duo() {
  const w = new World({
    bots: 0,
    mode: new BattleRoyale({ key: "brduo", countdown: 0 }),
  });
  for (let i = 0; i < 4; i++) w.addPlayer(`${i}`);
  w.step();
  for (const p of w.players.values())
    Object.assign(p, { team: Number(p.id) % 2, spawnShield: 0, levelGuard: 0 });
  w.gain = () => {};
  return w;
}
test("duo respawns automatically at 15 seconds by a living teammate, never earlier", () => {
  const w = duo(),
    a = w.players.get("0"),
    mate = w.players.get("2");
  w.damage(a, 9999, "1");
  assert.equal(a.respawnAt, w.time + 15);
  w.time = a.respawnAt - 0.05;
  assert.equal(w.respawn(a.id), false);
  w.step(0.01);
  assert.equal(a.alive, false);
  w.time = a.respawnAt;
  w.step();
  assert.equal(a.alive, true);
  assert.ok(Math.hypot(a.x - mate.x, a.z - mate.z) <= 3);
  assert.equal(a.level, 1);
});
test("a wiped pair cannot respawn, and the surviving pair shares first place", () => {
  const w = duo();
  w.damage(w.players.get("0"), 9999, "1");
  w.damage(w.players.get("2"), 9999, "1");
  w.step();
  assert.equal(w.mode.phase, "results");
  assert.equal(w.mode.winnerTeam, 1);
  for (const id of ["1", "3"])
    assert.equal(w.mode.results.find((p) => p.id === id).placement, 1);
  w.time += 16;
  assert.equal(w.respawn("0"), false);
});
test("a teammate dying before the revival deadline cancels that revival even with other teams alive", () => {
  const w = duo();
  w.players.get("3").team = 2;
  w.damage(w.players.get("0"), 9999, "1");
  w.time += 10;
  w.damage(w.players.get("2"), 9999, "1");
  w.time += 6;
  w.step();
  assert.equal(w.mode.phase, "playing");
  assert.equal(w.players.get("0").alive, false);
});
test("duel rare crystal cannot refill beneath a camping player or before its 45 second cooldown", () => {
  const w = new World({ bots: 0, mode: createMode("duel") });
  const a = w.addPlayer("a"),
    b = w.addPlayer("b");
  w.step();
  const gem = w.orbs.active.find((o) => o.rare);
  const point = { x: gem.x, z: gem.z };
  Object.assign(a, { ...point, levelGuard: 0 });
  b.x = 18;
  b.z = 0;
  w.step();
  assert.equal(w.events.filter((e) => e.type === "gem" && e.rare).length, 1);
  const ready = w.duelOrbReady.get(gem.duelSite);
  assert.ok(ready > w.time + 44);
  for (let i = 0; i < 300; i++) {
    a.pending = 0;
    a.choices = [];
    a.levelGuard = 0;
    w.step();
    assert.equal(w.events.filter((e) => e.type === "gem" && e.rare).length, 0);
  }
  w.time = ready + 1;
  for (let i = 0; i < 30; i++) w.spawnOrb();
  assert.equal(
    w.orbs.active.some((o) => o.rare && o.x === point.x && o.z === point.z),
    false,
  );
  Object.assign(a, { x: -18, z: 0 });
  for (let i = 0; i < 100; i++) w.spawnOrb();
  assert.equal(
    w.orbs.active.some((o) => o.rare && o.x === point.x && o.z === point.z),
    true,
  );
});
