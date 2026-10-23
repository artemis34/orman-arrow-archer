import test from "node:test";
import assert from "node:assert/strict";
import { NetworkTransport } from "../client/transport.js";

test("remote walking follows simulation time across jitter without freezes or backward frames", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const transport = new NetworkTransport(
    () => {},
    () => {},
  );
  transport.id = "viewer";
  const jitter = [0, 25, -15, 40, -5, 10, 35, -10];
  const packets = Array.from({ length: 120 }, (_, i) => ({
    at: (i / 15) * 1000 + 80 + jitter[i % jitter.length],
    state: {
      time: i / 15,
      players: [{ id: "remote", x: i / 5, z: 0, angle: 0, alive: true }],
      arrows: [],
    },
  })).sort((a, b) => a.at - b.at);
  const steps = [];
  let next = 0,
    previous;
  for (let frame = 0; frame < 470; frame++) {
    now = (frame * 1000) / 60;
    while (next < packets.length && packets[next].at <= now)
      transport.acceptState(packets[next++].state);
    const x = transport.view()?.players[0].x;
    if (now >= 1000 && previous !== undefined) steps.push(x - previous);
    previous = x;
  }
  assert.ok(steps.every((step) => Math.abs(step - 0.05) < 1e-8));
  assert.equal(
    transport.seq,
    0,
    "rendering never sends or advances simulation inputs",
  );
  assert.equal(transport.pending.length, 0);
  assert.ok(
    packets.every((packet, i) => packet.state.players[0].x === i / 5),
    "accepted transforms remain immutable",
  );
});

test("latest death, invulnerability and new-round positions override buffered transforms immediately", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const t = new NetworkTransport(
    () => {},
    () => {},
  );
  t.id = "viewer";
  function publish(x, changes = {}, round = 1) {
    now += 67;
    t.acceptState({
      time: now / 1000,
      match: { round, phase: "playing" },
      players: [
        { id: "enemy", x, z: 0, angle: 0, alive: true, hp: 150, ...changes },
      ],
      arrows: [],
    });
    return t.view().players[0];
  }
  publish(0);
  publish(0.2);
  publish(0.4);
  assert.equal(publish(0.6, { alive: false, hp: 0 }).alive, false);
  assert.equal(publish(20).x, 20, "respawn does not slide through the arena");
  assert.equal(publish(20.2, { levelGuard: 5 }).x, 20.2);
  assert.equal(
    publish(20.4, { levelGuard: 0 }).x,
    20.4,
    "protection expiry releases immediately",
  );
  assert.equal(
    publish(-18, {}, 2).x,
    -18,
    "rematch does not borrow a prior round's position",
  );
  now += 1000;
  assert.equal(
    t.view().players[0].x,
    -18,
    "long suspension never extrapolates actors",
  );
});
