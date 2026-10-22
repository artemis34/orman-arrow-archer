import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { BattleRoyale } from "../shared/modes.js";
import { SnapshotEncoder, SnapshotDecoder } from "../shared/protocol.js";
import { ArenaRoom } from "../cloudflare/worker.js";
const fixture = () => {
  const w = new World({ bots: 0, mode: new BattleRoyale({ countdown: 0 }) });
  const a = w.addPlayer("a"),
    b = w.addPlayer("b"),
    c = w.addPlayer("c", "Bot", 1, true);
  w.botInput = () => {};
  w.step();
  for (const p of w.players.values())
    Object.assign(p, { spawnShield: 0, levelGuard: 0 });
  return { w, a, b, c };
};
test("BR waits for a roster, allows solo combat and freezes out late joins and same-round respawns", () => {
  const w = new World({ bots: 0, mode: new BattleRoyale({ countdown: 1 }) });
  const a = w.addPlayer("a"),
    b = w.addPlayer("b");
  w.step();
  assert.equal(w.mode.phase, "waiting");
  assert.equal(w.damage(b, 1000, "a"), 0);
  for (let i = 0; i < 31; i++) w.step();
  assert.equal(w.mode.phase, "playing");
  assert.equal(a.team, null);
  assert.equal(b.team, null);
  assert.equal(w.mode.canDamage(a, b), true);
  assert.equal(w.addPlayer("late"), null);
  a.spawnShield = b.spawnShield = 0;
  w.damage(b, 1000, a.id);
  w.time += 4;
  assert.equal(w.respawn(b.id), false);
  w.step();
  assert.equal(w.mode.winnerId, a.id);
});
test("BR zone covers the original map, shrinks monotonically and applies server-side damage only outside", () => {
  const { w, a, b, c } = fixture();
  assert.ok(w.mode.zone.radius >= Math.hypot(42, 42));
  let previous = w.mode.zone.radius;
  for (const age of [0, 20, 40, 70, 110, 150, 195, 205]) {
    w.time = w.mode.startedAt + age;
    w.mode.updateZone(w);
    assert.ok(w.mode.zone.radius <= previous);
    previous = w.mode.zone.radius;
  }
  w.time = w.mode.startedAt + 100;
  Object.assign(a, { x: 0, z: 0 });
  Object.assign(b, { x: 40, z: 40 });
  Object.assign(c, { x: 5, z: 0 });
  const hp = b.hp;
  w.mode.step(w);
  assert.ok(b.hp < hp);
  assert.equal(a.hp, a.maxHp);
  assert.equal(c.hp, c.maxHp);
  const after = b.hp;
  w.mode.step(w);
  assert.equal(b.hp, after, "storm damage ticks at most once per second");
});
test("BR awards the last survivor over the player with more kills, then resets every participant for rematch", () => {
  const { w, a, b, c } = fixture();
  w.gain = () => {};
  b.kills = 10;
  b.matchPoints = 30;
  w.damage(c, 1000, a.id);
  w.time += 1;
  w.damage(b, 1000, a.id);
  w.step();
  assert.equal(w.mode.phase, "results");
  assert.equal(w.mode.winnerId, a.id);
  assert.deepEqual(
    w.mode.results.map((p) => [p.id, p.placement]),
    [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ],
  );
  assert.equal(w.damage(a, 9999, b.id), 0);
  w.mode.vote(w, a.id);
  w.mode.vote(w, b.id);
  w.step();
  assert.equal(w.mode.phase, "waiting");
  assert.equal(w.mode.round, 2);
  assert.equal(w.mode.zone.radius, 60);
  for (const p of w.players.values()) {
    assert.equal(p.alive, true);
    assert.equal(p.level, 1);
    assert.equal(p.kills, 0);
  }
});
test("BR does not revive eliminated bots or fill departed seats during combat", () => {
  const { w, a, c } = fixture();
  w.gain = () => {};
  w.damage(c, 1000, a.id);
  for (let i = 0; i < 120; i++) w.step();
  assert.equal(c.alive, false);
  w.removePlayer("b");
  w.setBotCount(15);
  assert.equal(w.players.size, 2);
  w.step();
  assert.equal(w.mode.winnerId, "a");
});
test("BR storm reaches the exact centre and simultaneous final deaths are a draw", () => {
  const { w, a, b, c } = fixture();
  for (const p of [a, b, c]) Object.assign(p, { x: 0, z: 0, hp: 1 });
  w.time = w.mode.startedAt + 200;
  w.mode.step(w);
  assert.equal(w.mode.phase, "results");
  assert.equal(w.mode.winnerId, null);
  assert.equal([...w.players.values()].filter((p) => p.alive).length, 0);
});
test("BR zone, survivor count and winner survive the existing binary snapshot protocol", () => {
  const { w, a } = fixture();
  const decoded = new SnapshotDecoder().decode(
    new SnapshotEncoder().encode(w.snapshot(a.id)),
  );
  assert.equal(decoded.match.format, "br");
  assert.equal(JSON.stringify(decoded.match.zone), JSON.stringify(w.mode.zone));
  assert.equal(decoded.match.survivors, 3);
  assert.equal(decoded.match.winnerId, null);
});
test("BR room rejects reservations after the round starts", async () => {
  const { w } = fixture();
  const room = new ArenaRoom({ getWebSockets: () => [] }, {});
  room.world = w;
  room.format = "br";
  const response = await room.fetch(
    new Request("https://internal/reserve?room=test-br&format=br", {
      method: "POST",
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(room.reservations.size, 0);
});
