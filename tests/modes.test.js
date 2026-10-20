import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { createMode, FORMATS, RoundMode } from "../shared/modes.js";
import { SnapshotEncoder, SnapshotDecoder } from "../shared/protocol.js";
import { applyArrowImpact, redirectRicochet } from "../shared/skills.js";
const clear = (world) => {
  world.obstacles = [];
  world.obstacleGrid.clear();
  while (world.orbs.active.length) world.orbs.release(0);
};
const place = (p, x, z) =>
  Object.assign(p, { x, z, spawnShield: 0, levelGuard: 0 });
for (const [key, rules] of Object.entries(FORMATS))
  test(`${key}: capacity, balanced teams and replicated rules`, () => {
    const world = new World({ bots: 0, mode: createMode(key) });
    for (let i = 0; i < rules.capacity; i++)
      assert.ok(world.addPlayer(`p${i}`));
    if (key !== "arena") assert.equal(world.addPlayer("overflow"), null);
    world.step();
    if (rules.teams)
      for (let i = 0; i < rules.teams; i++)
        assert.equal(
          [...world.players.values()].filter((p) => p.team === i).length,
          rules.capacity / rules.teams,
        );
    const state = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(world.snapshot("p0")),
    );
    assert.equal(state.match?.format || "arena", key);
    assert.equal(state.players[0].team, world.players.get("p0").team);
  });
test("teams protect against impacts, poison, blasts and automatic or explicit targeting", () => {
  const world = new World({ bots: 0, mode: createMode("t2") });
  const a = world.addPlayer("a"),
    enemy = world.addPlayer("enemy"),
    friend = world.addPlayer("friend");
  world.step();
  clear(world);
  world.gain = () => {};
  place(a, 0, 0);
  place(friend, 3, 0);
  place(enemy, 5, 0);
  assert.equal(a.team, friend.team);
  assert.equal(world.damage(friend, 100, a.id, "poison"), 0);
  a.lockedTargetId = friend.id;
  assert.equal(world.autoTarget(a).id, enemy.id);
  assert.equal(a.lockedTargetId, null);
  world.grid.clear();
  for (const p of world.players.values()) world.grid.insert(p, 0.62);
  a.blastCd = 0;
  applyArrowImpact(world, { owner: a.id, damage: 15, blast: true }, enemy);
  assert.equal(friend.hp, friend.maxHp);
  a.angle = 0;
  a.charge = 1;
  world.fire(a);
  for (let i = 0; i < 10; i++) world.step();
  assert.equal(friend.hp, friend.maxHp);
  assert.ok(enemy.hp < enemy.maxHp - 20);
});
test("ricochet can hit another opponent from the same enemy team", () => {
  const w = new World({ bots: 0, mode: createMode("t4") });
  const a = w.addPlayer("a"),
    b = w.addPlayer("b"),
    f = w.addPlayer("f"),
    c = w.addPlayer("c");
  w.step();
  clear(w);
  place(a, 0, 0);
  place(b, 4, 0);
  place(f, 5, 0);
  place(c, 7, 0);
  w.grid.clear();
  for (const p of w.players.values()) w.grid.insert(p, 0.62);
  const arrow = {
    owner: "a",
    hits: new Set(["b"]),
    ricochet: 1,
    vx: 30,
    vz: 0,
    damage: 15,
    poisonDps: 0,
    life: 0.5,
  };
  assert.equal(redirectRicochet(w, arrow, b), true);
  assert.ok(arrow.vx > 0);
  assert.equal(arrow.damage, 6);
});
test("a completed round freezes damage and movement, awards assists and supports immediate unanimous rematch", () => {
  const mode = new RoundMode("t2", { duration: 1 });
  const w = new World({ bots: 0, mode });
  const a = w.addPlayer("a"),
    b = w.addPlayer("b"),
    f = w.addPlayer("f");
  w.step();
  clear(w);
  w.gain = () => {};
  place(a, 0, 0);
  place(b, 8, 0);
  place(f, 0, 8);
  w.damage(b, 15, "f");
  w.damage(b, 1000, "a");
  assert.equal(a.kills, 1);
  assert.equal(f.assists, 1);
  assert.equal(mode.teamScores[a.team], 4);
  for (let i = 0; i < 32; i++) w.step();
  assert.equal(mode.phase, "results");
  assert.equal(mode.results.find((p) => p.id === "a").kills, 1);
  const x = a.x;
  w.setInput("a", { x: 1 });
  w.step();
  assert.equal(a.x, x);
  assert.equal(w.damage(a, 100, "b"), 0);
  assert.equal(w.respawn("b"), false);
  for (const id of ["a", "b", "f"]) assert.equal(mode.vote(w, id), true);
  w.step();
  w.step();
  assert.equal(mode.round, 2);
  assert.equal(mode.phase, "playing");
  for (const p of w.players.values())
    assert.equal(p.kills + p.assists + p.matchPoints, 0);
});
test("duels wait for a second player, have equal stats and symmetric cover, without XP or random cards", () => {
  const w = new World({ bots: 0, mode: createMode("duel") });
  const a = w.addPlayer("a");
  w.setInput("a", { x: 1 });
  w.step();
  assert.equal(w.mode.phase, "waiting");
  assert.equal(a.x, -18);
  w.botInput = () => {}; // Isolate symmetric spawn placement from the bot's first walking tick.
  const b = w.addPlayer("b", "bot", 0, true);
  w.step();
  assert.equal(w.mode.phase, "playing");
  assert.equal(a.hp, b.hp);
  assert.equal(a.x, -b.x);
  assert.equal(w.orbs.active.length, 0);
  w.gain(a, 10000);
  assert.equal(a.level, 1);
  assert.equal(w.snapshot("a").powerups.length, 0);
  for (const o of w.obstacles)
    assert.ok(
      w.obstacles.some((other) => other.x === -o.x && other.z === -o.z),
    );
});
test("friend groups can take a bot's team seat without exceeding team capacity", () => {
  const w = new World({ bots: 0, mode: createMode("t2") });
  const a = w.addPlayer("a", "A", 0, false, { party: "friends" });
  w.setBotCount(3);
  w.setBotCount(2);
  const b = w.addPlayer("b", "B", 0, false, { party: "friends" });
  assert.equal(a.team, b.team);
  for (let i = 0; i < 2; i++)
    assert.equal([...w.players.values()].filter((p) => p.team === i).length, 2);
});
test("shrine capture is contested by enemies and rewards a single side after four seconds", () => {
  const w = new World({ bots: 0 });
  const a = w.addPlayer("a"),
    b = w.addPlayer("b");
  clear(w);
  place(a, 0, 0);
  place(b, 1.4, 0);
  w.objective.nextAt = 0;
  for (let i = 0; i < 150; i++) w.step();
  assert.equal(w.objective.contested, true);
  assert.equal(a.objectives, 0);
  place(b, 20, 0);
  for (let i = 0; i < 125; i++) w.step();
  assert.equal(a.objectives, 1);
  assert.equal(b.objectives, 0);
  assert.equal(w.objective.active, false);
});
test("card rerolls are bounded and cannot add upgrades or extend protection", () => {
  const w = new World({ bots: 0 });
  const p = w.addPlayer("a");
  w.gain(p, 60);
  const guard = p.levelGuard;
  assert.equal(w.reroll("a"), true);
  assert.equal(w.reroll("a"), false);
  assert.equal(p.levelGuard, guard);
  assert.deepEqual(p.upgrades, {});
});
