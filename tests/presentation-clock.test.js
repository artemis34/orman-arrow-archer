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
  const released = publish(20.4, { levelGuard: 0 });
  assert.equal(released.levelGuard, 0, "protection expiry is live metadata");
  assert.ok(
    released.x >= 20.2,
    "release cannot rewind before its protection anchor",
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

test("remote selection release cannot rewind a character when its display buffer catches up", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const transport = new NetworkTransport(
    () => {},
    () => {},
  );
  transport.id = "viewer";
  let next = 0,
    previous = 0;
  const steps = [];
  for (let frame = 0; frame < 160; frame++) {
    now = (frame * 1000) / 60;
    while ((next / 15) * 1000 + 80 <= now) {
      const time = next++ / 15;
      const guarded = time >= 0.5 && time < 1;
      const x = time < 0.5 ? time * 3 : 1.5 + Math.max(0, time - 1) * 3;
      transport.acceptState({
        time,
        players: [
          {
            id: "remote",
            x,
            z: 0,
            angle: 0,
            alive: true,
            levelGuard: guarded ? 1 : 0,
          },
        ],
        arrows: [],
      });
    }
    const actor = transport.view()?.players[0];
    if (!actor) continue;
    if (now >= 1000 && now <= 2000) steps.push(actor.x - previous);
    previous = actor.x;
  }
  assert.ok(
    Math.min(...steps) >= -1e-8,
    `guard release moved backward by ${Math.min(...steps)}`,
  );
});

test("remote respawn and reappearance warm their own pose without replaying an older life", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const t = new NetworkTransport(
    () => {},
    () => {},
  );
  t.id = "viewer";
  let next = 0,
    previous;
  const steps = [];
  for (let frame = 0; frame < 160; frame++) {
    now = (frame * 1000) / 60;
    while ((next / 15) * 1000 + 80 <= now) {
      const time = next++ / 15;
      t.acceptState({
        time,
        players: [
          {
            id: "enemy",
            x: time < 1 ? 5 : -18 + (time - 1) * 3,
            z: 0,
            angle: 0,
            alive: time < 0.5 || time >= 1,
          },
        ],
        arrows: [],
      });
    }
    const actor = t.view()?.players[0];
    if (now > 1100 && now < 2000 && actor?.alive && previous !== undefined)
      steps.push(actor.x - previous);
    previous = actor?.x;
  }
  assert.ok(
    Math.min(...steps) >= -1e-8,
    `respawn rewound by ${Math.min(...steps)}`,
  );
  for (let i = 0; i < 40; i++) {
    now += 67;
    t.acceptState({
      time: now / 1000,
      players: [{ id: `visible-${i}`, x: i, z: 0, alive: true }],
      arrows: [],
    });
    t.view();
    assert.ok(
      t.remoteAnchors.size <= 1,
      "departed/hidden actors release transition storage",
    );
  }
});
