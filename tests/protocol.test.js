import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { ONLINE } from "../shared/online.js";
import {
  encodePacket,
  decodePacket,
  encodeInputs,
  decodeInputs,
  SnapshotEncoder,
  SnapshotDecoder,
} from "../shared/protocol.js";

test("binary values preserve unicode, flags, integers and nested data; malformed packets fail", () => {
  const value = [
    "Çağrı 🏹",
    true,
    false,
    null,
    -1234,
    2147483647,
    Math.PI,
    { x: [1, 2, 3] },
  ];
  const decoded = decodePacket(encodePacket(value));
  assert.deepEqual(JSON.parse(JSON.stringify(decoded)), value);
  for (const data of [
    new ArrayBuffer(0),
    encodePacket(value).slice(0, 6),
    Uint8Array.of(87, 66, 99, 0).buffer,
  ])
    assert.throws(() => decodePacket(data));
});
test("snapshot deltas reconstruct movement, mutable upgrades, removals and keyframes", () => {
  const w = new World({ bots: 0 }),
    p = w.addPlayer("me", "Çağrı");
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  const first = decoder.decode(encoder.encode(w.snapshot(p.id)));
  assert.equal(first.players[0].name, "Çağrı");
  const orbId = w.orbs.active[0].id;
  w.orbs.release(0);
  p.upgrades.pierce = 1;
  p.x += 1.234;
  p.choices = ["pierce"];
  const second = decoder.decode(encoder.encode(w.snapshot(p.id)));
  assert.equal(second.players[0].upgrades.pierce, 1);
  assert.deepEqual(second.players[0].choices, ["pierce"]);
  assert.ok(Math.abs(second.players[0].x - p.x) <= 0.0051);
  assert.ok(!second.orbs.some((o) => o.id === orbId));
  for (let n = 0; n < 80; n++) decoder.decode(encoder.encode(w.snapshot(p.id)));
  w.removePlayer(p.id);
  assert.equal(
    decoder.decode(encoder.encode(w.snapshot(p.id))).players.length,
    0,
  );
});
test("stationary XP is not retransmitted and steady-state packets shrink substantially", () => {
  const w = new World(),
    p = w.addPlayer("me"),
    encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  const state = w.snapshot(p.id),
    initial = encoder.encode(state);
  decoder.decode(initial);
  const next = encoder.encode(state),
    packet = decodePacket(next);
  assert.equal(packet[7].length, 0, "unchanged orbs have no delta");
  assert.equal(packet[11], null, "unchanged roster has no delta");
  assert.equal(decoder.decode(next).orbs.length, state.orbs.length);
  assert.ok(next.byteLength < JSON.stringify(state).length / 10);
});
test("interest filtering preserves local combat, distant rare objectives and a position-free roster", () => {
  const w = new World({ bots: 0 }),
    p = w.addPlayer("me"),
    q = w.addPlayer("far");
  Object.assign(p, { x: -30, z: -30 });
  Object.assign(q, { x: 30, z: 30 });
  const snapshot = w.snapshot(p.id, [], { radius: ONLINE.interestRadius });
  assert.ok(!snapshot.players.some((x) => x.id === q.id));
  assert.ok(snapshot.roster.some((x) => x.id === q.id));
  assert.ok(snapshot.roster.every((x) => !("x" in x) && !("z" in x)));
  const rare = w.orbs.active.filter((o) => o.rare);
  assert.ok(rare.every((o) => snapshot.orbs.some((n) => n.id === o.id)));
  q.hidden = true;
  Object.assign(q, { x: p.x + 6, z: p.z });
  assert.ok(
    !w
      .snapshot(p.id, [], { radius: ONLINE.interestRadius })
      .players.some((x) => x.id === q.id),
  );
});
test("binary inputs retain ordered edge actions and explicit unlock without accepting arbitrary stats", () => {
  const inputs = [
    { seq: 1, x: 1, z: 0, angle: Math.PI, charge: true, hp: 999 },
    {
      seq: 2,
      x: 0,
      z: -0.5,
      angle: 0,
      charge: false,
      dash: true,
      lockTarget: "target",
    },
    { seq: 3, x: 0, z: 0, angle: 0, lockTarget: null },
  ];
  const decoded = decodeInputs(encodeInputs(inputs));
  assert.equal(decoded[0].charge, true);
  assert.equal(decoded[1].charge, false);
  assert.equal(decoded[1].dash, true);
  assert.equal(decoded[0].hp, undefined);
  assert.equal(decoded[0].lockTarget, undefined);
  assert.equal(decoded[1].lockTarget, "target");
  assert.equal(decoded[2].lockTarget, null);
  assert.throws(() =>
    decodeInputs(encodeInputs(Array.from({ length: 5 }, () => inputs[0]))),
  );
});
