import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
function empty() {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  while (w.orbs.active.length) w.orbs.release(0);
  return w;
}
test("every unmodified human arrow deals 15 damage; charge changes speed and range", () => {
  const w = empty(),
    p = w.addPlayer("p");
  let previousSpeed = 0;
  for (const charge of [0.1, 0.55, 1]) {
    p.charge = charge;
    p.shotCd = 0;
    w.fire(p);
    const arrow = w.arrows.active.at(-1);
    assert.equal(arrow.damage, 15);
    assert.ok(arrow.vx > previousSpeed);
    previousSpeed = arrow.vx;
  }
  p.upgrades.multishot = 1;
  p.shotCd = 0;
  w.fire(p);
  assert.equal(
    w.arrows.active.slice(-3).reduce((n, a) => n + a.damage, 0),
    24,
  );
});
test("max poison lasts three seconds and deals nine extra damage instead of stacking duration", () => {
  const w = empty(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  Object.assign(a, {
    x: 0,
    z: 0,
    charge: 1,
    angle: 0,
    spawnShield: 0,
    upgrades: { poison: 3 },
  });
  Object.assign(b, { x: 5, z: 0, spawnShield: 0 });
  w.fire(a);
  for (let i = 0; i < 5; i++) w.step();
  assert.ok(b.poison > 2.9 && b.poison <= 3);
  assert.equal(b.poisonDps, 3);
  const hp = b.hp;
  for (let i = 0; i < 90; i++) w.step();
  assert.ok(Math.abs(hp - b.hp - 9) < 0.2);
  assert.ok(b.poison < 0.04);
});
test("rare crystals are capped, worth five normal crystals, and survive pool reuse correctly", () => {
  const forest = new World({ bots: 0 });
  const rare = forest.orbs.active.filter((o) => o.rare);
  assert.ok(rare.length > 0 && rare.length <= RULES.maxRareOrbs);
  assert.ok(rare.every((o) => o.value === RULES.orbXP * 5));
  const w = empty(),
    p = w.addPlayer("p");
  Object.assign(p, { x: 0, z: 0 });
  w.spawnOrb(0, 0, 60);
  w.step();
  assert.equal(p.level, 2);
  assert.equal(p.xp, 5);
  assert.ok(w.events.some((e) => e.type === "gem" && e.rare && e.value === 60));
  const regular = w.spawnOrb(15, 15, 12);
  assert.equal(regular.rare, false);
  assert.equal(regular.collected, false);
  assert.equal(w.snapshot(p.id).orbs[0].rare, false);
});
test("dead players cannot select vitality or heal through queued upgrades", () => {
  const w = empty(),
    p = w.addPlayer("p");
  Object.assign(p, { alive: false, hp: 0, pending: 1, choices: ["vitality"] });
  assert.equal(w.choose(p.id, "vitality"), false);
  assert.equal(p.hp, 0);
  assert.equal(p.maxHp, 150);
});
test("rare crystals attract a gathering bot from farther away than common XP", () => {
  const w = empty(),
    p = w.addPlayer("bot", "Bot", 0, true);
  Object.assign(p, { x: 0, z: 0, thinkAt: 0 });
  w.spawnOrb(5, 0, 12);
  w.spawnOrb(0, 10, 60);
  w.botInput(p, 1 / 30);
  assert.equal(p.brain, "gather");
  assert.ok(p.input.z > 0.9 && Math.abs(p.input.x) < 0.01);
});
test("poison ticks stay distinct from impact feedback while retaining their damage", () => {
  const w = empty(),
    a = w.addPlayer("a"),
    b = w.addPlayer("b");
  Object.assign(a, { x: 0, z: 0, spawnShield: 0 });
  Object.assign(b, { x: 10, z: 0, spawnShield: 0 });
  w.damage(b, 15, a.id);
  assert.equal(w.events.find((e) => e.type === "hit").kind, "impact");
  Object.assign(b, { poison: 3, poisonDps: 3, poisonOwner: a.id });
  const hp = b.hp;
  for (let i = 0; i < 30; i++) {
    w.step();
    assert.ok(
      w.events
        .filter((e) => e.type === "hit")
        .every((e) => e.kind === "poison"),
    );
  }
  assert.ok(Math.abs(b.hp - (hp - 3)) < 1e-6);
});
test("rapid manual tapping cannot bypass the attack cadence", () => {
  const w = empty(),
    p = w.addPlayer("p");
  let shots = 0;
  for (let tick = 0; tick < 30; tick++) {
    w.setInput(p.id, { charge: tick % 4 !== 3 });
    w.step();
    shots += w.events.filter(
      (e) => e.type === "shot" && e.owner === p.id,
    ).length;
  }
  assert.ok(shots > 0 && shots <= 2);
});
