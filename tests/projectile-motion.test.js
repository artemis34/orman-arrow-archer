import test from "node:test";
import assert from "node:assert/strict";
import { NetworkTransport, LocalTransport } from "../client/transport.js";
import { SnapshotEncoder, SnapshotDecoder } from "../shared/protocol.js";
import { ProjectilePresentation } from "../client/projectiles.js";

function jitterTrace(context, binary = false) {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const transport = new NetworkTransport(
    () => {},
    () => {},
  );
  transport.id = "viewer";
  transport.obstacles = [];
  const encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder();
  const queue = [];
  let arrival = 0;
  for (let n = 0; n < 42; n++) {
    const time = n / 15;
    arrival = Math.max(
      arrival + 1,
      time * 1000 + 60 + [0, 60, 0, 25, 0, 70][n % 6],
    );
    const state = {
      time,
      players: [],
      arrows: [{ id: 1, x: -35 + time * 20, z: 0, angle: 0 }],
      orbs: [],
      events: [],
      roster: [],
    };
    queue.push({
      at: arrival,
      state: binary ? decoder.decode(encoder.encode(state)) : state,
    });
  }
  const positions = [];
  for (let frame = 0; frame < 310; frame++) {
    now = (frame * 1000) / 120;
    while (queue.length && queue[0].at <= now) {
      const event = queue.shift();
      const frameAt = now;
      now = event.at;
      transport.acceptState(event.state);
      now = frameAt;
    }
    const arrow = transport.view()?.arrows[0];
    if (arrow && now > 500 && now < 2400) positions.push(arrow.x);
  }
  return positions.slice(1).map((x, i) => x - positions[i]);
}
for (const binary of [false, true])
  test(`arrows stay continuous at 120 FPS through 15 Hz ${binary ? "binary" : "JSON"} snapshots and 70 ms ordered jitter`, (context) => {
    const steps = jitterTrace(context, binary);
    const frozen = steps.filter((n) => Math.abs(n) < 0.001).length;
    assert.ok(
      Math.min(...steps) >= -0.0001,
      "a straight arrow cannot move backward",
    );
    assert.ok(
      frozen / steps.length < 0.02,
      `too many frozen frames: ${frozen}/${steps.length}`,
    );
    assert.ok(
      Math.max(...steps) < 0.23,
      `packet arrival caused a visible jump: ${Math.max(...steps)}`,
    );
  });

test("local arrows move between simulation ticks without advancing physics", () => {
  const transport = new LocalTransport();
  transport.world.obstacles = [];
  transport.world.obstacleGrid.clear();
  transport.world.players.clear();
  const me = transport.world.addPlayer(transport.id);
  Object.assign(me, { x: 0, z: 0, charge: 1, angle: 0 });
  transport.world.fire(me);
  transport.step({});
  transport.step({});
  const authority = transport.world.arrows.active[0].x;
  const a = transport.view(0).arrows[0].x;
  const b = transport.view(0.5).arrows[0].x;
  const c = transport.view(1).arrows[0].x;
  assert.ok(a < b && b < c);
  assert.equal(transport.world.arrows.active[0].x, authority);
  assert.equal(c, authority);
});

test("an authoritative impact removes an arrow immediately, including buffered history", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const t = new NetworkTransport(
    () => {},
    () => {},
  );
  t.id = "viewer";
  t.obstacles = [];
  for (let i = 0; i < 4; i++) {
    now = i * 67;
    t.acceptState({
      time: i / 15,
      players: [],
      arrows: [{ id: 1, x: i, z: 0, angle: 0 }],
    });
    t.view();
  }
  now += 10;
  t.acceptState({ time: 0.22, players: [], arrows: [] });
  assert.equal(
    t.view().arrows.length,
    0,
    "a known hit must not leave a ghost arrow",
  );
});

test("short-gap presentation is bounded and stops at solid cover and arena edges", () => {
  const snapshots = [0, 1, 2].map((n) => ({
    at: n * 100,
    state: { time: n / 10, arrows: [{ id: 1, x: n * 2, z: 0, angle: 0 }] },
  }));
  const presentation = new ProjectilePresentation();
  const at = (now, obstacles = []) =>
    presentation.view(snapshots, now, obstacles)[0];
  for (let now = 200; now <= 390; now += 10) at(now);
  assert.ok(
    at(400).x > 4,
    "brief gaps should not freeze a known straight flight",
  );
  assert.ok(
    at(410, [{ x: 5, z: 0, r: 0.5, type: "rock" }]).x <= 4.5,
    "visual continuation cannot cross solid cover",
  );
  assert.ok(at(420, [{ x: 5, z: 0, r: 0.5, type: "bush" }]).x > 4.5);
  assert.ok(at(1000).x <= 6, "a lost connection cannot fly arrows forever");
  snapshots[0].state.arrows[0].x = 37;
  snapshots[1].state.arrows[0].x = 39;
  snapshots[2].state.arrows[0].x = 41;
  assert.ok(at(1010).x <= 42, "visual continuation cannot leave the arena");
});

test("births, round changes and returning arrows do not borrow an unrelated trajectory", () => {
  const sample = (n, round, arrows) => ({
    at: n * 100,
    state: { time: n / 10, match: { round, phase: "playing" }, arrows },
  });
  const arrows = (n) => [{ id: 1, x: n, z: 0, angle: 0 }];
  const presentation = new ProjectilePresentation();
  const history = [
    sample(0, 1, []),
    sample(1, 1, arrows(1)),
    sample(2, 1, arrows(2)),
  ];
  assert.deepEqual(
    presentation.view(history, 150),
    [],
    "new arrows must not jump ahead of their first timestamp",
  );
  for (let now = 160; now <= 300; now += 10) presentation.view(history, now);
  history.push(sample(3, 2, arrows(30)));
  assert.deepEqual(
    presentation.view(history, 300),
    [],
    "a new round cannot interpolate the old round's arrow ID",
  );
  const turning = [
    sample(4, 2, [{ id: 2, x: 2, z: 0, angle: 0 }]),
    sample(5, 2, [{ id: 2, x: 4, z: 0, angle: Math.PI, effect: "returning" }]),
  ];
  const returning = new ProjectilePresentation();
  returning.view(turning, 500);
  for (let now = 510; now <= 740; now += 10) returning.view(turning, now);
  assert.equal(
    returning.view(turning, 750)[0].x,
    4,
    "a changed heading must not be extrapolated through a turn",
  );
});
