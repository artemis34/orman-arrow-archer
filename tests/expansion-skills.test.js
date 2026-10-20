import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { createMode } from "../shared/modes.js";
const arena = () => {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  while (w.orbs.active.length) w.orbs.release(0);
  w.random = () => 1;
  return w;
};
const place = (p, x, z) =>
  Object.assign(p, { x, z, spawnShield: 0, levelGuard: 0 });
test("initial practice encounters stay reachable while protected humans cannot be damaged", () => {
  const w = new World(),
    p = w.addPlayer("local");
  let reachable = 0;
  for (let i = 0; i < 90; i++) {
    w.step();
    assert.equal(p.hp, p.maxHp);
    if (w.autoTarget(p)) reachable++;
  }
  assert.ok(
    reachable > 10,
    "a protected initial spawn has a visible, nearby encounter after bot shields expire",
  );
});
test("crystal magnet extends only small XP collection, leaving rare objective pickup unchanged", () => {
  const w = arena(),
    p = w.addPlayer("p");
  place(p, 0, 0);
  p.upgrades.magnet = 1;
  w.spawnOrb(1.6, 0, 12);
  const rare = w.spawnOrb(-1.6, 0, 60);
  w.step();
  assert.equal(p.xp, 12);
  assert.ok(w.orbs.active.some((o) => o.id === rare.id));
});
test("protective shell reduces one impact per cooldown and never mitigates poison", () => {
  const w = arena(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  place(a, 0, 0);
  place(b, 8, 0);
  b.upgrades.shell = 1;
  assert.equal(w.damage(b, 15, "a"), 9);
  assert.equal(w.damage(b, 15, "a"), 15);
  assert.equal(w.damage(b, 3, "a", "poison"), 3);
  b.shellCd = 0;
  assert.equal(w.damage(b, 15, "a"), 9);
});
test("returning arrows hit each opponent once, have reduced return damage and still stop at cover", () => {
  const w = arena(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  place(a, 0, 0);
  place(b, 8, 0);
  w.gain = () => {};
  a.upgrades.returning = 1;
  a.charge = 1;
  a.angle = 0;
  w.fire(a);
  for (let i = 0; i < 6; i++) w.step();
  const returning = w.arrows.active.find((arrow) => arrow.returning);
  assert.ok(returning);
  assert.equal(returning.damage, 6);
  for (let i = 0; i < 20; i++) w.step();
  assert.ok(b.hp > b.maxHp - 16);
  assert.equal(w.arrows.active.length, 0);
  a.shotCd = 0;
  a.charge = 1;
  const cover = { x: 4, z: 0, r: 1, type: "rock" };
  w.obstacles.push(cover);
  w.obstacleGrid.insert(cover, 1);
  w.fire(a);
  for (let i = 0; i < 6; i++) w.step();
  assert.equal(w.arrows.active.length, 0);
});
test("evasion heals only an actual dodged arrow and obeys the six-second cooldown", () => {
  const w = arena(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  place(a, -2, 0);
  place(b, 0, 0);
  b.hp = 70;
  b.upgrades.evasion = 1;
  b.dashTime = 0.16;
  b.dashX = b.dashZ = 0;
  a.charge = 1;
  a.angle = 0;
  w.fire(a);
  w.step();
  assert.ok(b.hp > 78 && b.hp < 79);
  assert.equal(b.evadeCd, 6);
  a.shotCd = 0;
  a.charge = 1;
  w.fire(a);
  w.step();
  assert.ok(b.hp < 79);
});
test("disconnect cancels attacks so a departed teammate cannot cause unowned friendly fire", () => {
  const w = new World({ bots: 0, mode: createMode("t2") });
  const a = w.addPlayer("a"),
    enemy = w.addPlayer("e"),
    friend = w.addPlayer("f");
  w.step();
  w.obstacles = [];
  w.obstacleGrid.clear();
  place(a, 0, 0);
  place(friend, 4, 0);
  place(enemy, 8, 0);
  a.charge = 1;
  a.angle = 0;
  w.fire(a);
  w.removePlayer("a");
  for (let i = 0; i < 10; i++) w.step();
  assert.equal(friend.hp, friend.maxHp);
  assert.equal(w.arrows.active.length, 0);
});
