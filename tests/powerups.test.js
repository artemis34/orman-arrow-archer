import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { POWERUP_RULES, attackRate, arrowPower } from "../shared/powerups.js";
function setup() {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  while (w.orbs.active.length) w.orbs.release(0);
  w.powerups.sites[0].x = 0;
  w.powerups.sites[0].z = 0;
  w.powerups.sites[1].x = 10;
  w.powerups.sites[1].z = 0;
  const p = w.addPlayer("p");
  Object.assign(p, { x: 0, z: 0, spawnShield: 0 });
  return { w, p };
}
test("public powerup sites are bounded, separated and clear of cover across map seeds", () => {
  for (const seed of [1, 42, 7821, 987654]) {
    const w = new World({ bots: 0, seed });
    assert.equal(w.powerups.sites.length, 2);
    const [a, b] = w.powerups.sites;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 5);
    for (const s of w.powerups.sites) {
      assert.ok(
        Math.abs(s.x) < RULES.size / 2 && Math.abs(s.z) < RULES.size / 2,
      );
      assert.ok(
        w.obstacles.every((o) => Math.hypot(o.x - s.x, o.z - s.z) >= o.r + 2),
      );
    }
    const snapshot = w.snapshot();
    snapshot.powerups[0].cooldown = 1000;
    assert.equal(w.powerups.sites[0].cooldown, 0);
  }
});
test("one contender claims a site, and active buffs cannot be stacked or refreshed", () => {
  const { w, p } = setup();
  const q = w.addPlayer("q");
  Object.assign(q, { x: 0, z: 0, spawnShield: 0 });
  assert.equal(w.powerups.collect(p, w.events), true);
  assert.equal(w.powerups.collect(q, w.events), false);
  assert.equal(p.buffType, "haste");
  assert.equal(p.buffTime, 15);
  assert.equal(w.powerups.sites[0].cooldown, 45);
  p.x = 10;
  assert.equal(w.powerups.collect(p, w.events), false);
  assert.equal(w.powerups.sites[1].cooldown, 0);
  assert.equal(w.events.filter((e) => e.type === "buff").length, 1);
});
test("distance, death and protection prevent pickup, and input cannot forge a buff", () => {
  const { w, p } = setup();
  w.setInput(p.id, { buffType: "power", buffTime: 999 });
  assert.equal(p.buffType, null);
  assert.equal(w.choose(p.id, "power"), false);
  for (const extra of [
    { x: 2 },
    { alive: false },
    { levelGuard: 1 },
    { spawnShield: 1 },
  ]) {
    Object.assign(
      p,
      { x: 0, alive: true, levelGuard: 0, spawnShield: 0 },
      extra,
    );
    assert.equal(w.powerups.collect(p, w.events), false);
  }
  assert.equal(w.powerups.sites[0].cooldown, 0);
});
test("buffs expire after fifteen seconds and sites respawn independently after forty-five", () => {
  const { w, p } = setup();
  w.powerups.collect(p, w.events);
  w.powerups.tick(14.9, w.players.values());
  assert.ok(p.buffTime > 0);
  w.powerups.tick(0.11, w.players.values());
  assert.equal(p.buffTime, 0);
  assert.equal(p.buffType, null);
  assert.ok(w.powerups.sites[0].cooldown > 29);
  assert.equal(w.powerups.collect(p, w.events), false);
  w.powerups.tick(30, w.players.values());
  assert.equal(w.powerups.collect(p, w.events), true);
  assert.equal(p.buffTime, POWERUP_RULES.duration);
});
test("haste multiplies attack rate, draw and cooldown by 1.3 without changing arrow damage", () => {
  const { w, p } = setup();
  w.powerups.collect(p, w.events);
  p.x = 2;
  p.charge = 1;
  p.angle = 0;
  p.upgrades.draw = 3;
  w.fire(p);
  assert.equal(w.arrows.active[0].damage, 15);
  assert.ok(Math.abs(p.shotCd - (0.55 * Math.pow(0.88, 3)) / 1.3) < 1e-9);
  const q = w.addPlayer("q");
  Object.assign(q, { x: 2, z: 8, spawnShield: 0 });
  p.shotCd = 0;
  w.quickShot(p);
  assert.ok(Math.abs(p.shotCd - (0.65 * Math.pow(0.88, 3)) / 1.3) < 1e-9);
  p.charge = 0;
  p.shotCd = 0;
  w.setInput(p.id, { charge: true });
  w.step();
  assert.ok(
    Math.abs(p.charge - 1 / 30 / ((0.85 * Math.pow(0.88, 3)) / 1.3)) < 1e-9,
  );
  w.powerups.tick(15, w.players.values());
  assert.equal(attackRate(p), 1);
});
test("power adds twenty percent only to physical arrows, respects bot scaling and returns to base", () => {
  const { w, p } = setup();
  p.x = 10;
  w.powerups.collect(p, w.events);
  p.charge = 1;
  p.upgrades = { multishot: 1, rear: 1, poison: 3, blast: 1 };
  w.fire(p);
  assert.deepEqual(
    w.arrows.active.map((a) => Number(a.damage.toFixed(2))),
    [5.4, 18, 5.4, 9],
  );
  assert.equal(w.arrows.active.find((a) => a.damage === 18).poisonDps, 3);
  w.powerups.tick(15, w.players.values());
  assert.equal(arrowPower(p), 1);
  p.charge = 1;
  p.shotCd = 0;
  p.upgrades = {};
  w.fire(p);
  assert.equal(w.arrows.active.at(-1).damage, 15);
  p.bot = true;
  p.buffType = "power";
  p.buffTime = 15;
  p.shotCd = 0;
  p.charge = 1;
  w.fire(p);
  assert.equal(w.arrows.active.at(-1).damage, 13.5);
});
test("elimination and respawn remove buffs rather than carrying them into a new life", () => {
  const { w, p } = setup();
  w.powerups.collect(p, w.events);
  w.damage(p, 999);
  assert.equal(p.buffTime, 0);
  assert.equal(p.buffType, null);
  w.time += 3.1;
  assert.equal(w.respawn(p.id), true);
  assert.equal(p.buffTime, 0);
  assert.equal(attackRate(p), 1);
  assert.equal(arrowPower(p), 1);
});
