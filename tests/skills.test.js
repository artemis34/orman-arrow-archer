import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES, advanceMovement, cleanInput } from "../shared/config.js";
import { applyArrowImpact } from "../shared/skills.js";
const empty = () => {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  while (w.orbs.active.length) w.orbs.release(0);
  return w;
};
const add = (w, id, x, z) => {
  const p = w.addPlayer(id);
  Object.assign(p, { x, z, spawnShield: 0 });
  return p;
};
const run = (w, n) => {
  for (let i = 0; i < n; i++) w.step();
};
const shoot = (w, p, skills = {}) => {
  Object.assign(p, { upgrades: skills, angle: 0, charge: 1, shotCd: 0 });
  w.fire(p);
};
test("level-up grants a five-second freeze visible to enemies, blocks damage and actions, then resumes", () => {
  const w = empty(),
    p = add(w, "p", 0, 0),
    enemy = add(w, "e", 8, 0);
  p.hp = 80;
  p.hidden = true;
  w.gain(p, 60);
  assert.equal(p.levelGuard, RULES.levelGuardDuration);
  assert.equal(p.hidden, false);
  assert.equal(
    w.snapshot(enemy.id).players.find((v) => v.id === p.id).levelGuard,
    RULES.levelGuardDuration,
  );
  const hp = p.hp;
  w.damage(p, 999, enemy.id);
  assert.equal(p.hp, hp);
  w.setInput(p.id, {
    x: 1,
    dash: true,
    heal: true,
    charge: true,
    quickShot: true,
  });
  run(w, 30);
  assert.equal(p.x, 0);
  assert.equal(p.z, 0);
  assert.equal(p.dashTime, 0);
  assert.equal(p.healCd, 0);
  assert.equal(w.arrows.active.length, 0);
  assert.ok(p.levelGuard > 3.9 && p.levelGuard <= 4.01);
  run(w, 122);
  assert.equal(p.levelGuard, 0);
  assert.ok(p.x > 0);
  assert.ok(p.choices.length > 0);
  assert.equal(w.damage(p, 1, enemy.id), 1);
});
test("queued choices retain protection without refreshing it, and the final choice resumes play immediately", () => {
  const w = empty(),
    p = add(w, "p", 0, 0);
  w.gain(p, 200);
  run(w, 15);
  const remaining = p.levelGuard;
  w.choose(p.id, p.choices[0]);
  assert.equal(p.pending, 1);
  assert.equal(p.levelGuard, remaining);
  w.gain(p, 1);
  assert.equal(p.levelGuard, remaining);
  w.choose(p.id, p.choices[0]);
  assert.equal(p.levelGuard, 0);
  assert.equal(p.pending, 0);
  w.setInput(p.id, { x: 1 });
  w.step();
  assert.ok(p.x > 0);
});
test("a protected archer cannot attack through old arrows, poison, collision pushing or XP farming", () => {
  const w = empty(),
    p = add(w, "p", 0, 0),
    e = add(w, "e", 4, 0);
  shoot(w, p, { poison: 1 });
  e.poison = 3;
  e.poisonDps = 1;
  e.poisonOwner = p.id;
  w.gain(p, 60);
  assert.equal(e.poison, 0);
  w.spawnOrb(0, 0, 60);
  const xp = p.xp;
  w.setInput(e.id, { x: -1 });
  run(w, 15);
  assert.equal(p.x, 0);
  assert.equal(p.xp, xp);
  assert.equal(w.arrows.active.length, 0);
  p.charge = 1;
  assert.equal(w.fire(p), false);
  assert.equal(w.quickShot(p), false);
});
test("prediction and authority share protection and slow expiry rather than replaying forbidden movement", () => {
  const w = empty(),
    p = add(w, "p", 0, 0);
  p.levelGuard = 0.2;
  p.slowTime = 0.8;
  p.slowImmunity = 2;
  const predicted = structuredClone(p),
    input = cleanInput({ x: 1, dash: false });
  for (let i = 0; i < 25; i++) {
    w.setInput(p.id, input);
    w.step();
    advanceMovement(predicted, input, 1 / 30, []);
    assert.ok(Math.abs(p.x - predicted.x) < 1e-8);
  }
});
test("ricochet hits one extra visible enemy at 40% damage and never returns to an already-hit enemy", () => {
  const w = empty(),
    p = add(w, "p", 0, 0),
    a = add(w, "a", 5, 0),
    b = add(w, "b", 5, 4),
    c = add(w, "c", 5, 8);
  shoot(w, p, { ricochet: 1 });
  run(w, 30);
  assert.ok(a.hp < 136 && a.hp > 135);
  assert.ok(b.hp < 145 && b.hp > 144);
  assert.equal(c.hp, 150);
  assert.equal(w.arrows.active.length, 0);
});
test("frost slows movement briefly, does not lock controls, and cannot be refreshed during immunity", () => {
  const w = empty(),
    p = add(w, "p", 0, 0),
    a = add(w, "a", 5, 0);
  shoot(w, p, { frost: 1 });
  run(w, 5);
  assert.ok(a.slowTime > 0);
  const before = a.x;
  w.setInput(a.id, { x: 1 });
  w.step();
  assert.ok(
    Math.abs(a.x - before - (RULES.speed * (1 - RULES.frostSlow)) / 30) < 1e-7,
  );
  const slow = a.slowTime,
    arrow = { damage: 15, owner: p.id, frost: true };
  applyArrowImpact(w, arrow, a);
  assert.equal(a.slowTime, slow);
  run(w, 22);
  assert.equal(a.slowTime, 0);
  assert.ok(a.slowImmunity > 0);
  applyArrowImpact(w, arrow, a);
  assert.equal(a.slowTime, 0);
  w.setInput(a.id, { x: 1, dash: true });
  w.step();
  assert.ok(a.dashTime > 0);
});
test("blast deals four splash damage once per cooldown, respects cover, and does not add damage to the primary target", () => {
  const w = empty(),
    p = add(w, "p", 0, 0),
    a = add(w, "a", 5, 0),
    b = add(w, "b", 6.7, 0),
    hidden = add(w, "cover", 5, 1.8);
  const rock = { x: 5, z: 0.9, r: 0.12, type: "rock" };
  w.obstacles = [rock];
  w.obstacleGrid.insert(rock, rock.r);
  w.step();
  const arrow = { damage: 15, owner: p.id, blast: true };
  applyArrowImpact(w, arrow, a);
  assert.equal(a.hp, 135);
  assert.equal(b.hp, 146);
  assert.equal(hidden.hp, 150);
  assert.equal(p.blastCd, 1.1);
  applyArrowImpact(w, arrow, a);
  assert.equal(b.hp, 146);
  assert.equal(a.hp, 120);
});
test("protected and friendly targets cannot be slowed or used to trigger a blast", () => {
  const w = empty(),
    p = add(w, "p", 0, 0),
    a = add(w, "a", 5, 0);
  w.step();
  a.levelGuard = 4;
  const arrow = { damage: 15, owner: p.id, frost: true, blast: true };
  assert.equal(applyArrowImpact(w, arrow, a), false);
  assert.equal(a.hp, 150);
  assert.equal(a.slowTime, 0);
  assert.equal(p.blastCd, 0);
  a.levelGuard = 0;
  w.mode.canDamage = () => false;
  assert.equal(applyArrowImpact(w, arrow, a), false);
  assert.equal(p.blastCd, 0);
});
test("rear arrow stays at 50% damage without multiplying primary-only elemental effects", () => {
  const w = empty(),
    p = add(w, "p", 0, 0);
  shoot(w, p, {
    rear: 1,
    blast: 1,
    frost: 1,
    ricochet: 1,
    longshot: 1,
    poison: 3,
  });
  const back = w.arrows.active.find((a) => a.vx < 0);
  assert.equal(w.arrows.active.length, 2);
  assert.equal(back.damage, 7.5);
  assert.equal(back.blast, false);
  assert.equal(back.frost, false);
  assert.equal(back.ricochet, 0);
  assert.equal(back.longshot, false);
  assert.equal(back.poison, 0);
});
test("longshot is a capped 20% distance reward; base and close-range arrows remain 15 damage", () => {
  const w = empty(),
    p = add(w, "p", 0, 0),
    a = add(w, "a", 20, 0);
  const arrow = { damage: 15, owner: p.id, longshot: true };
  applyArrowImpact(w, arrow, a, 11);
  assert.equal(a.hp, 135);
  applyArrowImpact(w, arrow, a, 12);
  assert.equal(a.hp, 117);
  applyArrowImpact(w, arrow, a, 100);
  assert.equal(a.hp, 99);
});
test("combined projectile skills stay bounded through repeated fights, eliminations and pool reuse", () => {
  const w = new World(),
    p = w.addPlayer("stress");
  const build = {
    multishot: 1,
    pierce: 2,
    bounce: 2,
    poison: 3,
    speed: 2,
    draw: 3,
    vitality: 0,
    ricochet: 1,
    frost: 1,
    blast: 1,
    rear: 1,
    longshot: 1,
  };
  for (let tick = 0; tick < 2400; tick++) {
    for (const actor of w.players.values())
      Object.assign(actor.upgrades, build);
    if (!p.alive && w.time >= p.respawnAt) w.respawn(p.id);
    w.setInput(p.id, {
      x: Math.cos(tick * 0.02),
      z: Math.sin(tick * 0.02),
      angle: tick * 0.03,
      charge: tick % 30 < 25,
      dash: tick % 100 === 0,
      heal: p.hp < 70,
    });
    w.step();
    assert.ok(
      w.arrows.active.length <= RULES.maxArrows &&
        w.orbs.active.length <= RULES.maxOrbs,
    );
    for (const actor of w.players.values()) {
      assert.ok(
        Number.isFinite(actor.x) &&
          Number.isFinite(actor.z) &&
          Number.isFinite(actor.hp),
      );
      assert.ok(actor.hp >= 0 && actor.hp <= actor.maxHp);
      assert.ok(
        actor.levelGuard <= RULES.levelGuardDuration &&
          actor.slowTime <= RULES.frostDuration,
      );
    }
    for (const arrow of w.arrows.active)
      assert.ok(
        Number.isFinite(arrow.x) &&
          Number.isFinite(arrow.damage) &&
          Number.isFinite(arrow.distance),
      );
  }
  assert.ok([...w.players.values()].some((actor) => actor.kills > 0));
});
