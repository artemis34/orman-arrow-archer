import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES, cleanInput } from "../shared/config.js";
import { pauseStaleInput } from "../shared/online.js";

function arena() {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  while (w.orbs.active.length) w.orbs.release(0);
  w.random = () => 1;
  const p = w.addPlayer("me");
  const target = w.addPlayer("target");
  Object.assign(p, { x: 0, z: 0, spawnShield: 0 });
  Object.assign(target, { x: 0, z: 10, spawnShield: 0 });
  return { w, p, target };
}
const shots = (w) => w.events.filter((e) => e.type === "shot");

test("automatic mode uses authoritative targets, normal damage and the quick-shot cooldown", () => {
  const { w, p } = arena();
  assert.equal(cleanInput({ autoFire: "true" }).autoFire, false);
  w.setInput(p.id, { autoFire: true, angle: Math.PI, damage: 1000, x: 1 });
  w.step();
  assert.equal(shots(w).length, 1);
  const arrow = w.arrows.active[0];
  assert.equal(arrow.damage, RULES.arrowDamage);
  assert.ok(arrow.vz > 0 && arrow.vx < 0);
  assert.ok(Math.abs(Math.hypot(arrow.vx, arrow.vz) - (19 + 0.55 * 23)) < 1e-8);
  assert.ok(p.x > 0, "automatic fire does not stop walking");
  assert.equal(p.shotCd, RULES.quickShotCooldown);
  for (let n = 0; n < 18; n++) {
    w.setInput(p.id, { autoFire: true });
    w.step();
    assert.equal(shots(w).length, 0, "packet spam cannot bypass cooldown");
  }
  for (let n = 0; n < 3; n++) w.step();
  assert.ok(p.shotCd > 0.5, "automatic fire repeats after the normal wait");
});

test("automatic mode skips covered, out-of-range and protected targets; disabling stops repeats", () => {
  const { w, p, target } = arena();
  w.setInput(p.id, { autoFire: true });
  target.spawnShield = 2;
  w.step();
  assert.equal(shots(w).length, 0);
  target.spawnShield = 0;
  target.z = 30;
  w.step();
  assert.equal(shots(w).length, 0);
  target.z = 10;
  w.obstacles = [{ x: 0, z: 5, r: 1, type: "rock" }];
  w.step();
  assert.equal(shots(w).length, 0);
  w.obstacles = [];
  w.step();
  assert.equal(shots(w).length, 1);
  w.setInput(p.id, { autoFire: false });
  for (let n = 0; n < 40; n++) {
    w.step();
    assert.equal(shots(w).length, 0);
  }
});

test("manual draw and release beat automatic fire, preserving the release angle across batched inputs", () => {
  const { w, p } = arena();
  w.setInput(p.id, { autoFire: true, charge: true, angle: Math.PI });
  for (let n = 0; n < 20; n++) {
    w.step();
    assert.equal(shots(w).length, 0);
  }
  w.setInput(p.id, { autoFire: true, angle: Math.PI });
  w.setInput(p.id, { autoFire: true, angle: 0, x: 1 });
  w.step();
  assert.equal(shots(w).length, 1);
  assert.equal(shots(w)[0].quick, false);
  assert.ok(
    w.arrows.active[0].vx < 0,
    "manual shot keeps its release direction",
  );
  assert.ok(Math.abs(w.arrows.active[0].vz) < 1e-8);
  assert.equal(
    p.angle,
    0,
    "walking can turn the torso without redirecting that shot",
  );
  assert.equal(p.releaseAngle, null);
});

test("stale input, cancellation, selection guard and death cannot produce automatic shots", () => {
  const { w, p } = arena();
  w.setInput(p.id, { autoFire: true });
  pauseStaleInput(p, 400);
  for (let n = 0; n < 30; n++) w.step();
  assert.equal(w.arrows.active.length, 0);
  assert.equal(p.input.autoFire, false);
  w.setInput(p.id, { autoFire: true, cancelShot: true });
  w.step();
  assert.equal(shots(w).length, 0);
  p.levelGuard = 0.5;
  for (let n = 0; n < 12; n++) {
    w.setInput(p.id, { autoFire: true });
    w.step();
    assert.equal(shots(w).length, 0);
  }
  p.alive = false;
  p.levelGuard = 0;
  w.step();
  assert.equal(shots(w).length, 0);
});

test("automatic fire respects draw upgrades and temporary attack-rate buffs", () => {
  const { w, p } = arena();
  p.upgrades.draw = 2;
  p.buffType = "haste";
  p.buffTime = 15;
  w.setInput(p.id, { autoFire: true });
  w.step();
  assert.equal(shots(w).length, 1);
  assert.ok(Math.abs(p.shotCd - (0.65 * RULES.drawFactor ** 2) / 1.3) < 1e-8);
});
