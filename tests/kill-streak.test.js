import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import {
  SnapshotEncoder,
  SnapshotDecoder,
  decodePacket,
} from "../shared/protocol.js";
import { createMode } from "../shared/modes.js";

function arena(mode) {
  const world = new World({
    bots: 0,
    ...(mode ? { mode: createMode(mode) } : {}),
  });
  world.gain = () => {};
  const a = world.addPlayer("a"),
    b = world.addPlayer("b");
  for (const p of [a, b]) Object.assign(p, { spawnShield: 0, levelGuard: 0 });
  return { world, a, b };
}
const streak = (world, p) =>
  world.snapshot(p.id).roster.find((entry) => entry.id === p.id)?.killStreak ||
  0;
function revive(world, p) {
  world.time = Math.max(world.time, p.respawnAt + 0.1);
  assert.equal(world.respawn(p.id), true);
  p.spawnShield = 0;
}
test("only confirmed eliminations grow the life streak; death/respawn reset it while total kills remain", () => {
  const { world, a, b } = arena();
  world.damage(b, 15, a.id);
  assert.equal(streak(world, a), 0);
  world.damage(b, 999, a.id);
  assert.equal(streak(world, a), 1);
  world.damage(b, 999, a.id);
  assert.equal(streak(world, a), 1, "a corpse cannot be counted twice");
  revive(world, b);
  world.damage(b, 999, a.id);
  assert.equal(streak(world, a), 2);
  revive(world, b);
  world.damage(a, 999, b.id);
  assert.equal(streak(world, a), 0);
  assert.equal(a.kills, 2);
  revive(world, a);
  assert.equal(streak(world, a), 0);
  world.damage(b, 999, a.id);
  assert.equal(streak(world, a), 1);
  assert.equal(a.kills, 3);
});
test("posthumous kills keep normal kill credit without starting a new life streak", () => {
  const { world, a, b } = arena();
  world.damage(a, 999, b.id);
  world.damage(b, 999, a.id, "poison");
  assert.equal(a.kills, 1);
  assert.equal(streak(world, a), 0);
  assert.equal(streak(world, b), 0);
  revive(world, a);
  assert.equal(streak(world, a), 0);
});
test("friendly fire and forged input cannot grant streaks; a new round clears the counter", () => {
  const { world, a, b } = arena("t2");
  world.mode.phase = "playing";
  b.team = a.team;
  assert.equal(world.damage(b, 999, a.id), 0);
  world.setInput(a.id, { killStreak: 9999 });
  assert.equal(streak(world, a), 0);
  b.team = 1 - a.team;
  world.damage(b, 999, a.id);
  assert.equal(streak(world, a), 1);
  world.mode.phase = "waiting";
  world.resetRound();
  assert.equal(streak(world, a), 0);
  assert.equal(a.kills, 0);
});
test("optional streak metadata survives v2 keyframes/deltas and disappears on death without adding player tuple fields", () => {
  const { world, a, b } = arena();
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  let packet = encoder.encode(world.snapshot(a.id));
  const before = decodePacket(packet);
  decoder.decode(packet);
  world.damage(b, 999, a.id);
  let view = decoder.decode(encoder.encode(world.snapshot(a.id)));
  assert.equal(view.roster.find((p) => p.id === a.id).killStreak, 1);
  view = decoder.decode(encoder.encode(world.snapshot(a.id)));
  assert.equal(view.roster.find((p) => p.id === a.id).killStreak, 1);
  revive(world, b);
  world.damage(b, 999, a.id);
  packet = encoder.encode(world.snapshot(a.id));
  assert.equal(decodePacket(packet).length, before.length);
  view = decoder.decode(packet);
  assert.equal(view.roster.find((p) => p.id === a.id).killStreak, 2);
  revive(world, b);
  world.damage(a, 999, b.id);
  view = decoder.decode(encoder.encode(world.snapshot(a.id)));
  assert.equal(view.roster.find((p) => p.id === a.id).killStreak, undefined);
});
