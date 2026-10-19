import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { selectTarget, aimedAngle } from "../shared/aim.js";
import { createPose, updatePose } from "../client/presentation.js";
const setup = () => {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  const p = w.addPlayer("me");
  Object.assign(p, { x: 0, z: 0 });
  return { w, p };
};
const enemy = (w, id, x, z, extra = {}) => {
  const p = w.addPlayer(id, id, 0, true);
  Object.assign(p, { x, z, spawnShield: 0, ...extra });
  return p;
};
test("humans start and respawn with extra health and a four-second shield; bots stay weaker", () => {
  const { w, p } = setup(),
    b = enemy(w, "b", 20, 0);
  assert.equal(p.hp, 150);
  assert.equal(p.spawnShield, 4);
  assert.equal(b.maxHp, 100);
  w.damage(p, 50, b.id);
  assert.equal(p.hp, 150);
  p.spawnShield = 0;
  w.damage(p, 999, b.id);
  w.time += 3.1;
  assert.equal(w.respawn(p.id), true);
  assert.equal(p.hp, 150);
  assert.equal(p.spawnShield, 4);
});
test("bots deal 25 percent less arrow damage; firing ends protection", () => {
  const { w, p } = setup(),
    b = enemy(w, "b", 20, 0);
  b.charge = 1;
  w.fire(b);
  assert.equal(w.arrows.active[0].damage, 15 * 0.75);
  p.charge = 1;
  w.fire(p);
  assert.equal(p.spawnShield, 0);
  assert.equal(w.arrows.active[1].damage, 15);
});
test("auto target skips dead, shielded, hidden and covered enemies", () => {
  const { w, p } = setup();
  enemy(w, "hidden", 6, 0, { hidden: true });
  enemy(w, "shield", 2, 0, { spawnShield: 2 });
  enemy(w, "dead", 1, 0, { alive: false });
  enemy(w, "covered", 10, 0);
  const good = enemy(w, "clear", 0, 12);
  w.obstacles = [{ x: 5, z: 0, r: 1, type: "rock" }];
  assert.equal(
    selectTarget(p, [...w.players.values()], w.obstacles).id,
    good.id,
  );
  good.z = 30;
  assert.equal(selectTarget(p, [...w.players.values()], w.obstacles), null);
});
test("quick tap fires one server-selected arrow and respects cooldown under packet bursts", () => {
  const { w, p } = setup();
  enemy(w, "near", 0, 10);
  enemy(w, "far", 15, 0);
  w.setInput(p.id, { quickShot: true, angle: Math.PI });
  w.setInput(p.id, {});
  w.step();
  assert.equal(w.arrows.active.length, 1);
  assert.ok(Math.abs(w.arrows.active[0].vx) < 0.001);
  assert.ok(w.arrows.active[0].vz > 0);
  assert.equal(p.spawnShield, 0);
  assert.equal(p.charge, 0);
  for (let i = 0; i < 6; i++) {
    w.setInput(p.id, { quickShot: true });
    w.step();
  }
  assert.equal(w.events.filter((e) => e.type === "shot").length, 0);
  assert.ok(p.shotCd > 0);
});
test("auto aim selects lowest absolute health in range and retains it when equal-health enemies move", () => {
  const { w, p } = setup();
  const near = enemy(w, "near", 5, 0, { hp: 80, maxHp: 200 });
  const weak = enemy(w, "weak", 0, 12, { hp: 35, maxHp: 100 });
  enemy(w, "outside", 25, 0, { hp: 1 });
  enemy(w, "protected", 0, 6, { hp: 1, levelGuard: 2 });
  assert.equal(w.autoTarget(p).id, weak.id);
  assert.equal(
    w.snapshot(p.id).players.find((v) => v.id === p.id).autoTargetId,
    weak.id,
  );
  weak.hp = near.hp;
  for (let i = 0; i < 20; i++) {
    near.x = 3 + Math.sin(i);
    weak.z = 12 + Math.cos(i);
    assert.equal(w.autoTarget(p).id, weak.id);
    const snapshot = w.snapshot(p.id);
    const me = snapshot.players.find((v) => v.id === p.id);
    assert.equal(selectTarget(me, snapshot.players.reverse(), []).id, weak.id);
  }
  near.hp = 20;
  assert.equal(
    w.autoTarget(p).id,
    near.id,
    "a strictly weaker valid enemy takes priority",
  );
  near.hidden = true;
  near.x = 8;
  assert.equal(w.autoTarget(p).id, weak.id, "hidden targets are excluded");
  weak.z = 23;
  assert.equal(w.autoTarget(p), null);
});
test("quick shots authoritatively attack the weakest opponent rather than accepting a forged target", () => {
  const { w, p } = setup();
  enemy(w, "near", 5, 0, { hp: 90 });
  const weak = enemy(w, "weak", 0, 12, { hp: 30 });
  w.setInput(p.id, { quickShot: true, autoTargetId: "near", angle: 0 });
  w.step();
  assert.equal(p.autoTargetId, weak.id);
  assert.ok(Math.abs(w.arrows.active[0].vx) < 0.001);
  assert.ok(w.arrows.active[0].vz > 0);
  weak.spawnShield = 2;
  assert.equal(w.autoTarget(p).id, "near");
});
test("tap without target does not consume protection or release a partial stick draw", () => {
  const { w, p } = setup();
  p.charge = 0.2;
  w.setInput(p.id, { quickShot: true });
  w.step();
  assert.equal(w.arrows.active.length, 0);
  assert.ok(p.spawnShield > 3.9);
  assert.equal(p.shotCd, 0);
});
test("tap request cannot interrupt a manual charged shot", () => {
  const { w, p } = setup();
  enemy(w, "b", 10, 0);
  w.setInput(p.id, { charge: true, quickShot: true });
  w.step();
  assert.equal(w.arrows.active.length, 0);
  assert.ok(p.charge > 0);
});
test("leading aim predicts lateral movement while retaining physical projectiles", () => {
  const shooter = { x: 0, z: 0 },
    target = { x: 10, z: 0, vx: 0, vz: 6 };
  const angle = aimedAngle(shooter, target, 32, []);
  assert.ok(angle > 0 && angle < 0.4);
  assert.equal(aimedAngle(shooter, { ...target, vz: 0 }, 32, []), 0);
});
test("walking presentation remains continuous between 30 Hz simulation ticks", () => {
  const target = { x: 0, z: 0, alive: true, dashTime: 0 },
    pose = createPose(target);
  let movingFrames = 0;
  for (let frame = 0; frame < 120; frame++) {
    target.x = (Math.floor(frame / 2) * RULES.speed) / 30;
    updatePose(pose, target, 1 / 60);
    if (frame > 20 && pose.weight > 0.8) movingFrames++;
  }
  assert.equal(movingFrames, 99);
  const phase = pose.phase;
  for (let f = 0; f < 90; f++) updatePose(pose, target, 1 / 60);
  assert.ok(pose.weight < 0.01);
  assert.ok(pose.phase >= phase);
});
test("respawn snaps the render pose instead of animating a walk across the arena", () => {
  const pose = createPose({ x: -25, z: 0, alive: false });
  updatePose(pose, { x: 25, z: 0, alive: true }, 1 / 60);
  assert.equal(pose.x, 25);
  assert.equal(pose.weight, 0);
});
test("turning follows the short arc across pi while footsteps follow travel rather than aim", () => {
  const p = { x: 0, z: 0, angle: Math.PI - 0.04, alive: true, dashTime: 0 };
  const pose = createPose(p);
  p.angle = -Math.PI + 0.04;
  updatePose(pose, p, 1 / 60);
  assert.ok(Math.abs(pose.facing - (Math.PI - 0.04)) < 0.08);
  assert.equal(pose.phase, 0, "turning in place must not play walking steps");
  for (let f = 0; f < 60; f++) {
    p.z += 0.1;
    updatePose(pose, p, 1 / 60);
  }
  assert.ok(Math.abs(pose.moveAngle - Math.PI / 2) < 0.01);
  assert.ok(pose.weight > 0.8 && pose.phase > 0);
});
test("small idle network corrections do not spin the walking direction", () => {
  const p = { x: 0, z: 0, angle: 0, alive: true, dashTime: 0 };
  const pose = createPose(p);
  for (let i = 0; i < 60; i++) {
    p.x = i % 2 ? -0.002 : 0.002;
    updatePose(pose, p, 1 / 60);
  }
  assert.equal(pose.moveAngle, 0);
  assert.ok(pose.weight < 0.02);
});
