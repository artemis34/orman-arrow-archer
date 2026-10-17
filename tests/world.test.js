import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES, cleanInput } from "../shared/config.js";
import { Pool, SpatialGrid, segmentHit } from "../shared/spatial.js";
const world = () => {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  return w;
};
function position(p, x, z) {
  Object.assign(p, { x, z, spawnShield: 0 });
}
function shoot(w, p, charge = 1) {
  p.angle = 0;
  p.charge = charge;
  w.fire(p);
}
test("untrusted inputs are finite, normalized, and cannot choose damage or position", () => {
  assert.deepEqual(
    cleanInput({
      x: Infinity,
      z: NaN,
      angle: "x",
      charge: 1,
      dash: "true",
      seq: -5,
    }),
    {
      x: 0,
      z: 0,
      angle: 0,
      charge: false,
      dash: false,
      heal: false,
      quickShot: false,
      seq: 0,
    },
  );
  const w = world(),
    p = w.addPlayer("a");
  position(p, 0, 0);
  w.setInput("a", { x: 100, z: 100, hp: 9999, damage: 10000 });
  w.step();
  assert.ok(Math.hypot(p.x, p.z) <= RULES.speed / RULES.tick + 0.001);
  assert.equal(p.hp, RULES.playerHealth);
});
test("charging and releasing produces authoritative damage; arrow pool is reused", () => {
  const w = world(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  position(a, 0, 0);
  position(b, 9, 0);
  w.setInput("a", { charge: true, angle: 0 });
  for (let i = 0; i < 30; i++) w.step();
  assert.equal(w.arrows.active.length, 0);
  w.setInput("a", { charge: false, angle: 0 });
  for (let i = 0; i < 10; i++) w.step();
  assert.ok(b.hp < b.maxHp - 30);
  assert.ok(a.score > 0);
  assert.equal(w.arrows.active.length, 0);
  assert.equal(w.arrows.free.length, RULES.maxArrows);
});
test("cover stops swept arrows", () => {
  const w = world(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  position(a, 0, 0);
  position(b, 10, 0);
  const cover = { x: 5, z: 0, r: 1, type: "rock" };
  w.obstacles = [cover];
  w.obstacleGrid.insert(cover, 1);
  shoot(w, a);
  for (let i = 0; i < 20; i++) w.step();
  assert.equal(b.hp, RULES.playerHealth);
  assert.equal(w.arrows.active.length, 0);
});
test("dash grants brief evasion, obeys cooldown and arena bounds", () => {
  const w = world(),
    p = w.addPlayer("a");
  position(p, 40, 0);
  w.setInput("a", { x: 1, dash: true });
  w.step();
  assert.equal(p.dashCd, 3);
  assert.ok(p.dashTime > 0);
  w.setInput("a", { x: 1, dash: true });
  w.step();
  assert.ok(p.dashCd < 3);
  for (let i = 0; i < 20; i++) w.step();
  assert.ok(p.x <= 42 - RULES.radius);
});
test("gems grant levels, three valid choices and no forged upgrades", () => {
  const w = world(),
    p = w.addPlayer("a");
  position(p, 0, 0);
  w.gain(p, 120);
  assert.equal(p.level, 2);
  assert.equal(p.pending, 1);
  assert.equal(p.choices.length, 3);
  assert.equal(w.choose("a", "forged"), false);
  const k = p.choices[0];
  assert.equal(w.choose("a", k), true);
  assert.equal(p.upgrades[k], 1);
  assert.equal(w.choose("a", k), false);
});
test("bush camouflage removes remote actors from snapshots; charging reveals", () => {
  const w = world(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  position(a, 0, 0);
  position(b, 15, 0);
  w.obstacles = [{ x: 0, z: 0, r: 2, type: "bush" }];
  w.step();
  assert.equal(
    w.snapshot("b").players.some((p) => p.id === "a"),
    false,
  );
  assert.ok(w.snapshot("a").players.some((p) => p.id === "a"));
  w.setInput("a", { charge: true });
  w.step();
  assert.ok(w.snapshot("b").players.some((p) => p.id === "a"));
});
test("death drops XP, enforces respawn delay and resets progression", () => {
  const w = world(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  position(a, 0, 0);
  position(b, 4, 0);
  w.gain(b, 100);
  w.damage(b, 200, "a");
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1);
  assert.equal(w.respawn("b"), false);
  for (let i = 0; i < 92; i++) w.step();
  assert.equal(w.respawn("b"), true);
  assert.equal(b.level, 1);
  assert.equal(b.hp, RULES.playerHealth);
  assert.ok(b.spawnShield > 0);
});
test("multishot, piercing, bounce, poison and upgrade caps work", () => {
  const w = world(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b"),
    c = w.addPlayer("c");
  position(a, 0, 0);
  position(b, 6, 0);
  position(c, 10, 0);
  a.upgrades = { multishot: 1, pierce: 1, poison: 1 };
  shoot(w, a);
  assert.equal(w.arrows.active.length, 3);
  for (let i = 0; i < 15; i++) w.step();
  assert.ok(b.hp < b.maxHp && c.hp < c.maxHp);
  assert.ok(c.poison > 0);
  const before = c.hp;
  for (let i = 0; i < 30; i++) w.step();
  assert.ok(c.hp < before);
  a.upgrades = { bounce: 1 };
  a.shotCd = 0;
  position(a, 39, 15);
  shoot(w, a);
  for (let i = 0; i < 5; i++) w.step();
  assert.ok(w.arrows.active.some((o) => o.owner === "a" && o.vx < 0));
});
test("spatial grid queries nearby objects and swept tests cannot tunnel", () => {
  const grid = new SpatialGrid(4),
    a = { x: 0, z: 0 },
    b = { x: 50, z: 50 };
  grid.insert(a);
  grid.insert(b);
  assert.deepEqual([...grid.query(0, 0, 2)], [a]);
  assert.equal(segmentHit(0, 0, 100, 0, 50, 0.3, 0.6), true);
  assert.equal(segmentHit(0, 0, 100, 0, 50, 2, 0.6), false);
});
test("bounded pools and long-running simulation stay finite", () => {
  const pool = new Pool(() => ({}), 2);
  assert.ok(pool.acquire());
  assert.ok(pool.acquire());
  assert.equal(pool.acquire(), undefined);
  pool.release(0);
  assert.ok(pool.acquire());
  const w = new World();
  for (let i = 0; i < 1800; i++) w.step();
  assert.ok(w.arrows.active.length <= RULES.maxArrows);
  assert.ok(w.orbs.active.length <= RULES.maxOrbs);
  for (const p of w.players.values())
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.hp));
  assert.ok([...w.players.values()].some((p) => p.score > 0));
});
test("player bodies separate and cover behind a target does not swallow the hit", () => {
  const w = world(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  position(a, 0, 0);
  position(b, 0, 0);
  w.step();
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= RULES.radius * 2 - 0.001);
  position(a, 0, 0);
  position(b, 4, 0);
  const rock = { x: 5.7, z: 0, r: 0.5, type: "rock" };
  w.obstacles = [rock];
  w.obstacleGrid.insert(rock, 0.5);
  shoot(w, a);
  for (let i = 0; i < 8; i++) w.step();
  assert.ok(b.hp < b.maxHp);
});
test("malformed names and skin objects cannot crash the authority", () => {
  const w = world();
  assert.doesNotThrow(() =>
    w.addPlayer("bad", { toString: 0 }, { valueOf: 0, toString: 0 }),
  );
  assert.equal(w.players.get("bad").name, "Gezgin");
  assert.equal(w.players.get("bad").skin, 0);
});
test("forest breath heals on authority and cannot bypass cooldown", () => {
  const w = world(),
    p = w.addPlayer("a");
  position(p, 0, 0);
  p.hp = 40;
  w.setInput("a", { heal: true });
  w.step();
  assert.ok(p.hp >= 65 && p.hp < 66);
  assert.equal(p.healCd, 14);
  w.setInput("a", { heal: true });
  w.step();
  assert.ok(p.hp < 66);
  assert.ok(w.snapshot("a").players[0].healCd > 13);
});
test("poison rewards total damage rather than granting XP for every tiny tick", () => {
  const w = world(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  position(a, 0, 0);
  position(b, 4, 0);
  for (let i = 0; i < 90; i++) w.damage(b, 4 / 30, "a");
  assert.equal(a.score, 4);
  assert.ok(Math.abs(b.hp - (b.maxHp - 12)) < 0.001);
});
