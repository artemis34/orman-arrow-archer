import test from "node:test";
import assert from "node:assert/strict";
import { NetworkTransport } from "../client/transport.js";

function frozenState(frame) {
  const players = Array.from({ length: 16 }, (_, i) =>
    Object.freeze({
      id: i ? `remote-${i}` : "local",
      alive: true,
      x: frame / 10 + i,
      z: 2,
      angle: frame / 100,
      levelGuard: 0,
      hp: 150 - frame / 10,
      seq: frame,
      upgrades: Object.freeze({}),
    }),
  );
  return Object.freeze({
    time: frame / 15,
    players: Object.freeze(players),
    arrows: Object.freeze([
      Object.freeze({ id: "arrow", x: frame / 2, z: 1, angle: 0 }),
    ]),
  });
}
test("presentation indexes reuse lookups without mutating received state or extending the snapshot buffer", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const transport = new NetworkTransport(
    () => {},
    () => {},
  );
  transport.id = "local";
  transport.obstacles = [];
  const first = frozenState(0),
    original = JSON.stringify(first);
  transport.acceptState(first);
  transport.view();
  const record = transport.snapshots[0],
    players = record.playerIndex,
    arrows = record.arrowIndex;
  for (let i = 0; i < 12; i++) {
    now += 1;
    transport.view();
  }
  assert.equal(record.playerIndex, players);
  assert.equal(record.arrowIndex, arrows);
  assert.equal(JSON.stringify(first), original);
  for (let frame = 1; frame < 200; frame++) {
    now = (frame * 1000) / 15;
    const state = frozenState(frame);
    transport.acceptState(state);
    for (let view = 0; view < 8; view++) {
      now += 1000 / 120;
      transport.view();
    }
    assert.ok(transport.snapshots.length <= 8);
    assert.ok(
      transport.snapshots.reduce(
        (n, s) => n + Number(!!s.playerIndex) + Number(!!s.arrowIndex),
        0,
      ) <= 16,
    );
  }
  assert.ok(
    !transport.snapshots.includes(record),
    "old index records leave with their snapshots",
  );
  assert.equal(
    transport.snapshots.at(-1).state.players[0].hp,
    130.1,
    "latest authoritative metadata is retained",
  );
  assert.equal(JSON.stringify(first), original);
});
