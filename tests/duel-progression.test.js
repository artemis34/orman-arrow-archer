import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { createMode } from "../shared/modes.js";
import { SnapshotEncoder, SnapshotDecoder } from "../shared/protocol.js";

function match(format = "duel") {
  const w = new World({ bots: 0, mode: createMode(format) });
  const a = w.addPlayer("a"),
    b = w.addPlayer("b");
  w.step();
  a.spawnShield = b.spawnShield = 0;
  return { w, a, b };
}

test("public duel starts equal and supplies mirrored, bounded XP and neutral buffs", () => {
  const { w, a, b } = match();
  assert.equal(a.hp, b.hp);
  assert.equal(a.hp, RULES.playerHealth);
  assert.equal(a.level, 1);
  assert.equal(b.level, 1);
  assert.equal(a.x, -b.x);
  assert.equal(w.orbs.active.length, 26);
  assert.equal(w.orbs.active.filter((o) => o.rare).length, 2);
  for (const o of w.orbs.active) {
    assert.ok(
      w.orbs.active.some(
        (p) => p.x === -o.x && p.z === -o.z && p.value === o.value,
      ),
    );
    assert.ok(
      w.obstacles.every((p) => Math.hypot(o.x - p.x, o.z - p.z) > p.r + 2),
    );
    assert.ok(Math.abs(o.x) <= 24 && Math.abs(o.z) <= 18);
  }
  assert.equal(w.snapshot(a.id).powerups.length, 2);
  for (const p of w.powerups.sites)
    assert.equal(
      Math.hypot(p.x - a.x, p.z - a.z),
      Math.hypot(p.x - b.x, p.z - b.z),
    );
});

test("public duel earns cards, grants five seconds of protection and resumes immediately after choosing", () => {
  const { w, a, b } = match();
  w.gain(a, 60);
  assert.equal(a.level, 2);
  assert.equal(a.pending, 1);
  assert.equal(a.choices.length, 3);
  assert.equal(a.levelGuard, 5);
  const hp = a.hp;
  assert.equal(w.damage(a, 15, b.id), 0);
  assert.equal(a.hp, hp);
  const x = a.x;
  w.setInput(a.id, { x: 1, charge: true, quickShot: true });
  w.step();
  assert.equal(a.x, x);
  assert.equal(w.arrows.active.length, 0);
  const choice = a.choices[0];
  assert.equal(w.choose(a.id, choice), true);
  assert.equal(a.levelGuard, 0);
  assert.equal(a.upgrades[choice], 1);
  w.setInput(a.id, { x: 1 });
  w.step();
  assert.ok(a.x > x);
});

test("public duel elimination grants XP, drops crystals and respawns at equal level-one health", () => {
  const { w, a, b } = match();
  const initial = w.orbs.active.length;
  w.damage(b, 9999, a.id);
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1);
  assert.ok(a.level > 1);
  assert.ok(a.pending > 0);
  assert.equal(w.orbs.active.length, initial + 5);
  w.time += 3.1;
  assert.equal(w.respawn(b.id), true);
  assert.equal(b.level, 1);
  assert.equal(b.hp, RULES.playerHealth);
  assert.equal(b.x, 18);
  assert.equal(b.z, 0);
});

test("public duel parachutes are contested centrally, limited to one and grant one level on landing", () => {
  const { w, a, b } = match();
  w.time = w.loot.nextAt;
  w.loot.tick(w);
  assert.equal(w.loot.drops.length, 1);
  const drop = w.loot.drops[0];
  assert.equal(drop.x, 0);
  assert.equal(
    Math.hypot(drop.x - a.x, drop.z - a.z),
    Math.hypot(drop.x - b.x, drop.z - b.z),
  );
  assert.ok(
    w.obstacles.every(
      (o) => Math.hypot(o.x - drop.x, o.z - drop.z) > o.r + 2.3,
    ),
  );
  Object.assign(a, { x: drop.x, z: drop.z, xp: 20 });
  w.loot.tick(w);
  assert.equal(a.level, 1);
  w.time = drop.landAt + 0.01;
  w.loot.tick(w);
  assert.equal(a.level, 2);
  assert.equal(a.xp, 0);
  assert.equal(a.levelGuard, 5);
  assert.equal(w.loot.drops.length, 0);
  w.loot.tick(w);
  assert.equal(a.level, 2);
  const decoded = new SnapshotDecoder().decode(
    new SnapshotEncoder().encode(w.snapshot(a.id)),
  );
  assert.equal(decoded.players.find((p) => p.id === a.id).levelGuard, 5);
  assert.equal(decoded.players.find((p) => p.id === a.id).choices.length, 3);
});

test("legacy ranked links resolve to the ordinary progressive duel without rating", () => {
  const { w, a } = match("ranked");
  assert.equal(w.mode.id, "duel");
  assert.equal(w.mode.rules.ranked, undefined);
  w.gain(a, 60);
  assert.equal(a.level, 2);
  assert.equal(a.choices.length, 3);
  assert.ok(w.orbs.active.length > 0);
});
