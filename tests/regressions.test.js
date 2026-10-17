import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
const empty = () => {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  return w;
};
test("dash and heal presses survive newer movement packets before the server tick", () => {
  const w = empty(),
    p = w.addPlayer("a");
  Object.assign(p, { x: 0, z: 0, hp: 50, spawnShield: 0 });
  w.setInput("a", { x: 1, dash: true, heal: true, seq: 1 });
  w.setInput("a", { x: 1, seq: 2 });
  w.step();
  assert.equal(p.dashCd, 3);
  assert.equal(p.healCd, 14);
  assert.ok(p.hp > 74);
  assert.equal(p.seq, 2);
});
test("a player killed by poison cannot collect crystals or level up in that tick", () => {
  const w = empty(),
    p = w.addPlayer("a");
  Object.assign(p, { x: 0, z: 0, hp: 0.01, spawnShield: 0, poison: 1, xp: 50 });
  Object.assign(w.orbs.active[0], { x: 0, z: 0 });
  w.step();
  assert.equal(p.alive, false);
  assert.equal(p.hp, 0);
  assert.equal(p.xp, 50);
  assert.equal(p.level, 1);
});
test("hidden victims do not leak positions through damage events", () => {
  const w = empty(),
    victim = w.addPlayer("hidden"),
    observer = w.addPlayer("observer");
  Object.assign(victim, { x: 0, z: 0, hidden: true, spawnShield: 0 });
  Object.assign(observer, { x: 20, z: 0 });
  w.damage(victim, 1, observer.id);
  const snapshot = w.snapshot(observer.id);
  assert.ok(!snapshot.players.some((p) => p.id === victim.id));
  assert.ok(!snapshot.events.some((e) => e.target === victim.id));
  assert.ok(w.snapshot(victim.id).events.some((e) => e.target === victim.id));
});
test("mode tick events are retained in the snapshot", () => {
  const w = empty();
  w.mode.step = (world) =>
    world.events.push({ type: "match", message: "round started" });
  w.step();
  assert.ok(w.snapshot().events.some((e) => e.type === "match"));
});
