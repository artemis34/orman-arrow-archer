import test from "node:test";
import assert from "node:assert/strict";
import { LocalTransport } from "../client/transport.js";
import { createPose, updatePose } from "../client/presentation.js";
import { RULES } from "../shared/config.js";

const player = (changes = {}) => ({
  id: "local",
  x: 0,
  z: 0,
  angle: 0,
  alive: true,
  hp: 150,
  levelGuard: 0,
  ...changes,
});
const snapshot = (players, match = null) => ({ players, arrows: [], match });

function harness() {
  const transport = new LocalTransport();
  let next;
  transport.world = {
    events: [],
    setInput() {},
    step() {},
    snapshot() {
      return next;
    },
  };
  return {
    transport,
    publish(state) {
      next = state;
      return transport.step({});
    },
  };
}

test("practice presents positions between ticks with live combat metadata and immutable snapshots", () => {
  const { transport: t, publish } = harness();
  assert.equal(t.view(), null);
  const previous = snapshot([player()]);
  publish(previous);
  assert.equal(t.view(0).players, previous.players);
  const latest = snapshot([
    player({ x: 0.3, z: -0.4, hp: 19, angle: 2.5, choices: ["speed"] }),
  ]);
  const saved = structuredClone([previous, latest]);
  Object.freeze(previous.players[0]);
  Object.freeze(latest.players[0]);
  publish(latest);
  const middle = t.view(0.5).players[0];
  assert.equal(middle.x, 0.15);
  assert.equal(middle.z, -0.2);
  assert.equal(middle.hp, 19);
  assert.equal(
    middle.angle,
    2.5,
    "aim stays responsive, just as online local aim does",
  );
  assert.deepEqual(middle.choices, ["speed"]);
  const index = t.previousState.playerIndex;
  assert.equal(t.view(0).players[0].x, 0);
  assert.equal(t.view(1).players[0].x, 0.3);
  assert.equal(t.view(-2).players[0].x, 0);
  assert.equal(t.view(2).players[0].x, 0.3);
  assert.equal(t.view(Number.NaN).players[0].x, 0.3);
  assert.equal(
    t.previousState.playerIndex,
    index,
    "one lookup is cached per tick",
  );
  assert.deepEqual([previous, latest], saved);
});

test("practice death, new visibility, respawn and teleports never replay an older life", () => {
  const { transport: t, publish } = harness();
  publish(
    snapshot([
      player(),
      player({ id: "gone", x: 4 }),
      player({ id: "respawn", x: 3, alive: false, hp: 0 }),
      player({ id: "teleport", x: -10 }),
    ]),
  );
  const latest = snapshot([
    player({ x: 0.2, alive: false, hp: 0 }),
    player({ id: "new", x: 8 }),
    player({ id: "respawn", x: -3 }),
    player({ id: "teleport", x: 10 }),
  ]);
  publish(latest);
  const visible = t.view(0).players;
  assert.deepEqual(visible, latest.players);
  assert.equal(
    visible.some((p) => p.id === "gone"),
    false,
  );
  assert.equal(visible[0].alive, false);
  assert.equal(visible[0].hp, 0);
});

test("practice protection snaps immediately and release resumes without rewinding", () => {
  const { transport: t, publish } = harness();
  publish(snapshot([player()]));
  publish(snapshot([player({ x: 0.2, levelGuard: 5 })]));
  assert.equal(t.view(0).players[0].x, 0.2);
  assert.equal(t.view(0).players[0].levelGuard, 5);
  publish(snapshot([player({ x: 0.2, levelGuard: 2 })]));
  assert.equal(t.view(0.5).players[0].x, 0.2);
  publish(snapshot([player({ x: 0.4 })]));
  const start = t.view(0).players[0];
  const middle = t.view(0.5).players[0];
  const end = t.view(1).players[0];
  assert.equal(
    start.levelGuard,
    0,
    "expiry/early selection completion is live metadata",
  );
  assert.equal(start.x, 0.2);
  assert.ok(middle.x > start.x && end.x > middle.x);
  publish(snapshot([player({ x: 0.6 })]));
  assert.equal(t.view(0).players[0].x, end.x);
});

test("practice sharp turns and stick release continue from the last displayed endpoint", () => {
  const { transport: t, publish } = harness();
  publish(snapshot([player()]));
  publish(snapshot([player({ x: 0.25 })]));
  const end = t.view(1).players[0];
  publish(snapshot([player({ x: 0.25, z: 0.25, angle: Math.PI / 2 })]));
  const turn = t.view(0).players[0];
  assert.equal(turn.x, end.x);
  assert.equal(turn.z, end.z);
  assert.equal(turn.angle, Math.PI / 2);
  assert.equal(t.view(0.5).players[0].z, 0.125);
  publish(snapshot([player({ x: 0.25, z: 0.25 })]));
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const stopped = t.view(fraction).players[0];
    assert.equal(stopped.x, 0.25);
    assert.equal(stopped.z, 0.25);
  }
});

test("practice round changes and frozen match phases bypass transform interpolation", () => {
  const { transport: t, publish } = harness();
  const match = (round, phase) => ({ round, phase });
  publish(snapshot([player()], match(1, "playing")));
  publish(snapshot([player({ x: 0.4 })], match(1, "results")));
  assert.equal(t.view(0).players[0].x, 0.4);
  publish(snapshot([player({ x: 0.5 })], match(1, "results")));
  assert.equal(t.view(0).players[0].x, 0.5);
  publish(snapshot([player({ x: -2 })], match(1, "playing")));
  assert.equal(t.view(0).players[0].x, -2);
  publish(snapshot([player({ x: 2 })], match(2, "playing")));
  assert.equal(t.view(0).players[0].x, 2);
  publish(snapshot([player({ x: 2.2 })], match(2, "playing")));
  assert.equal(t.view(0.5).players[0].x, 2.1);
});

for (const displayRate of [60, 120])
  test(`30 Hz practice authority produces steady ${displayRate} Hz walk and camera speed`, async () => {
    const t = new LocalTransport();
    await t.connect("Pacer", 0);
    t.world.setBotCount(0);
    t.world.obstacles = [];
    t.world.obstacleGrid.clear();
    t.world.gain = () => {};
    const me = t.world.players.get(t.id);
    Object.assign(me, { x: -36, z: 0, spawnShield: 0, levelGuard: 0 });
    const raw = createPose(me),
      smooth = createPose(me),
      rawSpeeds = [],
      smoothSpeeds = [],
      rawCameraSpeeds = [],
      smoothCameraSpeeds = [];
    let rawCamera = me.x,
      smoothCamera = me.x;
    const framesPerTick = displayRate / RULES.tick,
      dt = 1 / displayRate,
      follow = 1 - Math.exp(-dt * 8);
    for (let frame = 0; frame < displayRate * 10; frame++) {
      if (frame % framesPerTick === 0) t.step({ x: 1, angle: 0 });
      const rawBefore = raw.x,
        smoothBefore = smooth.x,
        rawCameraBefore = rawCamera,
        smoothCameraBefore = smoothCamera;
      // Match scene.render's camera-then-pose order, including its easing.
      rawCamera += (raw.x - rawCamera) * follow;
      smoothCamera += (smooth.x - smoothCamera) * follow;
      updatePose(raw, t.currentState.state.players[0], dt);
      updatePose(
        smooth,
        t.view((frame % framesPerTick) / framesPerTick).players[0],
        dt,
      );
      if (frame > displayRate * 2) {
        rawSpeeds.push((raw.x - rawBefore) / dt);
        smoothSpeeds.push((smooth.x - smoothBefore) / dt);
        rawCameraSpeeds.push((rawCamera - rawCameraBefore) / dt);
        smoothCameraSpeeds.push((smoothCamera - smoothCameraBefore) / dt);
      }
    }
    const deviation = (values) => {
      const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
      return Math.sqrt(
        values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length,
      );
    };
    assert.ok(
      deviation(rawSpeeds) > 1.4,
      "reproducer retains the former alternating walk speed",
    );
    assert.ok(deviation(smoothSpeeds) < 0.00001);
    assert.ok(deviation(rawCameraSpeeds) > 0.05);
    assert.ok(deviation(smoothCameraSpeeds) < 0.00001);
    assert.ok(
      smoothSpeeds.every((speed) => Math.abs(speed - RULES.speed) < 0.00001),
    );
    assert.ok(Math.abs(me.x - (-36 + RULES.speed * 10)) < 1e-8);
    assert.ok(
      Math.abs(t.world.time - 10) < 1e-8,
      "rendering never advances authoritative ticks",
    );
  });
