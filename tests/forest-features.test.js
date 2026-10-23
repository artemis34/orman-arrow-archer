import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES, UPGRADES } from "../shared/config.js";
import { applyArrowImpact } from "../shared/skills.js";
import { createMode } from "../shared/modes.js";
import { LootDrops } from "../shared/loot.js";
import { newProfile, award, recordActivity } from "../shared/profile.js";
import { rankFor, titleFor } from "../shared/ranking.js";
import { SnapshotEncoder, SnapshotDecoder } from "../shared/protocol.js";
function duel() {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  const a = w.addPlayer("a"),
    b = w.addPlayer("b");
  Object.assign(a, { x: 0, z: 0, spawnShield: 0, hp: 100 });
  Object.assign(b, { x: 5, z: 0, spawnShield: 0, hp: 150 });
  w.gain = () => {};
  return { w, a, b };
}
const arrow = (owner) => ({
  owner: owner.id,
  damage: 15,
  poison: 0,
  frost: false,
  blast: false,
  hits: new Set(),
  cancelled: false,
});
test("a physical critical hit adds exactly ten percent and emits HeadShot feedback only on confirmed hits", () => {
  const { w, a, b } = duel();
  w.combatRandom = () => 0;
  assert.ok(applyArrowImpact(w, arrow(a), b));
  assert.equal(b.hp, 133.5);
  assert.equal(w.events.find((e) => e.type === "hit").critical, true);
  w.events = [];
  b.spawnShield = 1;
  assert.equal(applyArrowImpact(w, arrow(a), b), false);
  assert.equal(w.events.length, 0);
  b.spawnShield = 0;
  w.combatRandom = () => 1;
  applyArrowImpact(w, arrow(a), b);
  assert.equal(b.hp, 118.5);
  assert.ok(!w.events.at(-1).critical);
  const hp = b.hp;
  w.damage(b, 2, a.id, "poison");
  assert.equal(b.hp, hp - 2);
  assert.ok(!w.events.at(-1).critical);
});
test("the independent combat RNG yields a five percent critical chance without changing terrain RNG", () => {
  const w = new World({ bots: 0 }),
    seed = w.seed;
  let hits = 0;
  for (let i = 0; i < 100000; i++)
    hits += w.combatRandom() < RULES.criticalChance;
  assert.ok(hits > 4700 && hits < 5300, `critical rate ${hits / 1000}%`);
  assert.equal(w.seed, seed);
});
test("lifesteal heals from actual impact damage with hit/second caps and never heals dead/full/protected targets", () => {
  const { w, a, b } = duel();
  w.combatRandom = () => 1;
  a.upgrades.lifesteal = 1;
  b.hp = 10000;
  for (let i = 0; i < 8; i++) applyArrowImpact(w, arrow(a), b);
  assert.equal(a.hp, 103);
  w.time = 1.01;
  applyArrowImpact(w, arrow(a), b);
  assert.equal(a.hp, 103.75);
  const before = a.hp;
  w.damage(b, 3, a.id, "poison");
  assert.equal(a.hp, before);
  a.hp = a.maxHp;
  applyArrowImpact(w, arrow(a), b);
  assert.equal(a.hp, a.maxHp);
  a.alive = false;
  a.hp = 0;
  applyArrowImpact(w, arrow(a), b);
  assert.equal(a.hp, 0);
  assert.equal(Object.keys(UPGRADES).filter((k) => k === "ricochet").length, 1);
  assert.equal(RULES.ricochetScale, 0.4);
});
test("loot preserves terrain/XP, announces before landing, then grants exactly one level once", () => {
  const w = new World({ bots: 0 }),
    p = w.addPlayer("p");
  const terrain = JSON.stringify(w.obstacles),
    orbs = JSON.stringify(w.orbs.active),
    seed = w.seed;
  w.time = 45;
  w.loot.tick(w);
  assert.equal(w.loot.drops.length, 1);
  assert.equal(w.seed, seed);
  assert.equal(JSON.stringify(w.obstacles), terrain);
  assert.equal(JSON.stringify(w.orbs.active), orbs);
  const d = w.loot.drops[0];
  Object.assign(p, { x: d.x, z: d.z, xp: 20, spawnShield: 0 });
  w.loot.tick(w);
  assert.equal(p.level, 1);
  w.time = d.landAt + 0.01;
  w.loot.tick(w);
  assert.equal(p.level, 2);
  assert.equal(p.xp, 0);
  assert.equal(w.loot.drops.length, 0);
  assert.equal(p.levelGuard, RULES.levelGuardDuration);
  w.loot.tick(w);
  assert.equal(p.level, 2);
  assert.equal(w.events.filter((e) => e.type === "lootClaim").length, 1);
});
test("loot density is bounded, population/area aware, obstruction free and absent in equal-start ranked duels", () => {
  const w = new World({ bots: 0 });
  w.addPlayer("p");
  const initial = w.loot.interval(w);
  for (let i = 0; i < 15; i++) w.addPlayer(`p${i}`);
  assert.ok(w.loot.interval(w) < initial);
  assert.ok(
    new LootDrops(1, 168).interval(w) <= new LootDrops(1, 42).interval(w),
  );
  for (let i = 0; i < 6000; i++) {
    w.time = i / 10;
    w.loot.tick(w);
    assert.ok(w.loot.drops.length <= 3);
    for (const d of w.loot.drops)
      assert.ok(
        w.obstacles.every(
          (o) =>
            o.type === "bush" || Math.hypot(o.x - d.x, o.z - d.z) >= o.r + 2.3,
        ),
      );
  }
  for (const key of ["ranked"]) {
    const d = new World({ bots: 0, mode: createMode(key) });
    d.time = 200;
    d.loot.tick(d);
    assert.equal(d.loot.drops.length, 0);
    assert.equal(d.orbs.active.length, 0);
  }
});
test("loot state roundtrips through the existing v2 tuple and kill feedback cannot reveal hidden coordinates", () => {
  const { w, a, b } = duel();
  w.loot.spawn(w);
  const state = w.snapshot(a.id);
  const decoded = new SnapshotDecoder().decode(
    new SnapshotEncoder().encode(state),
  );
  assert.deepEqual(
    decoded.objective.drops.map((o) => ({ ...o })),
    state.objective.drops,
  );
  Object.assign(a, { x: 20, z: 0 });
  Object.assign(b, { x: 0, z: 0, hidden: true, hp: 1 });
  w.damage(b, 2, a.id);
  const e = w.snapshot(a.id).events.find((e) => e.type === "kill");
  assert.equal(e.owner, a.id);
  assert.ok(!("x" in e) && !("z" in e));
});
test("ranked starts at zero independently of old kills; receipts cannot inflate rank and titles follow lifetime kills", () => {
  const p = newProfile();
  p.stats.kills = 5000;
  assert.equal(rankFor(p.ranked.points).name, "Tohum");
  assert.equal(titleFor(p.stats.kills).name, "Efsane Okçu");
  award(p, { receipt: "r1", ranked: true, outcome: "win", win: true });
  assert.equal(p.ranked.points, 25);
  award(p, { receipt: "r1", ranked: true, outcome: "win" });
  assert.equal(p.ranked.points, 25);
  award(p, { receipt: "casual", kills: 10, win: true });
  assert.equal(p.ranked.points, 25);
  recordActivity(p, { receipt: "activity1", kills: 2 });
  recordActivity(p, { receipt: "activity1", kills: 2 });
  assert.equal(p.stats.kills, 5012);
  for (let i = 0; i < 4; i++)
    award(p, { receipt: `loss${i}`, ranked: true, outcome: "loss" });
  assert.equal(p.ranked.points, 0);
  assert.equal(titleFor(9).name, "Çırak");
  assert.equal(titleFor(10).name, "İzci");
  assert.equal(titleFor(50).name, "Avcı");
});
