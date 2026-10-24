import test from "node:test";
import assert from "node:assert/strict";
import { NetworkTransport } from "../client/transport.js";

// Synthetic read-only trajectories isolate transport timing from physics/GPU.
// Authority still advances exactly 1/15 s per packet even if its timer is slow.
function trace(
  context,
  {
    interval = 1000 / 15,
    jitter = [0],
    duration = 8000,
    fps = 60,
    start = 1000,
    rounds = false,
    recovery = false,
  } = {},
) {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const transport = new NetworkTransport(
    () => {},
    () => {},
  );
  transport.id = "viewer";
  transport.obstacles = [];
  const packets = [];
  let at = 60,
    previousAt = 0;
  for (let i = 0; i < duration / 40; i++) {
    at += recovery && i >= 45 ? 1000 / 15 : interval;
    const arrival = Math.max(previousAt + 1, at + jitter[i % jitter.length]);
    previousAt = arrival;
    const time = i / 15;
    packets.push({
      at: arrival,
      state: {
        time,
        ...(rounds
          ? { match: { round: 1 + Math.floor(time / 30), phase: "playing" } }
          : {}),
        players: [
          { id: "remote", x: -20 + time * 0.2, z: 0, angle: 0, alive: true },
        ],
        arrows: [{ id: 1, x: -20 + time * 0.2, z: 0, angle: 0 }],
      },
    });
  }
  const positions = { player: [], arrow: [] };
  let previous = {},
    previousRound;
  let maxLag = 0,
    maxDelay = 0,
    maxTimings = 0;
  for (let frame = 0; frame < (duration * fps) / 1000; frame++) {
    now = (frame * 1000) / fps;
    while (packets[0]?.at <= now) {
      const packet = packets.shift(),
        frameAt = now;
      now = packet.at;
      transport.acceptState(packet.state);
      now = frameAt;
    }
    const view = transport.view();
    if (!view) continue;
    const round = view.match?.round;
    const current = { player: view.players[0].x, arrow: view.arrows[0]?.x };
    if (now > start && round === previousRound) {
      for (const key of ["player", "arrow"])
        if (previous[key] !== undefined && current[key] !== undefined)
          positions[key].push(current[key] - previous[key]);
    }
    previous = current;
    previousRound = round;
    const latest = transport.snapshots.at(-1).state.time * 1000;
    maxLag = Math.max(maxLag, latest - transport.playerClock.time);
    maxDelay = Math.max(
      maxDelay,
      transport.playerClock.delay,
      transport.projectiles.clock.delay,
    );
    maxTimings = Math.max(
      maxTimings,
      transport.playerClock.timings.length,
      transport.projectiles.clock.timings.length,
    );
    assert.ok(Number.isFinite(current.player));
    if (current.arrow !== undefined) assert.ok(Number.isFinite(current.arrow));
  }
  const metrics = (steps) => ({
    frozen: steps.filter((step) => Math.abs(step) < 1e-8).length / steps.length,
    backward: steps.filter((step) => step < -1e-8).length,
    max: Math.max(...steps),
    min: Math.min(...steps),
    count: steps.length,
  });
  return {
    transport,
    player: metrics(positions.player),
    arrow: metrics(positions.arrow),
    maxLag,
    maxDelay,
    maxTimings,
  };
}

for (const rate of [15, 14, 12.5, 10]) {
  test(`${rate} actual snapshots/s keep fixed-step arrows and remote players continuous`, (context) => {
    const result = trace(context, { interval: 1000 / rate });
    for (const kind of ["player", "arrow"]) {
      assert.ok(result[kind].count > 300);
      assert.equal(result[kind].frozen, 0, JSON.stringify(result[kind]));
      assert.equal(result[kind].backward, 0);
      assert.ok(result[kind].max < 0.004, JSON.stringify(result[kind]));
    }
    assert.equal(result.transport.playerClock.delay, 125);
    assert.equal(result.transport.projectiles.clock.delay, 100);
    assert.equal(
      result.maxDelay,
      125,
      "steady clock drift must not be classified as packet jitter",
    );
    assert.equal(
      result.transport.seq,
      0,
      "presentation never sends input or advances authority",
    );
    assert.equal(result.transport.pending.length, 0);
    assert.ok(result.maxTimings <= 16);
  });
}

for (const burst of [150, 200]) {
  test(`${burst} ms ordered packet bursts use a bounded display buffer without backward arrows`, (context) => {
    const result = trace(context, { jitter: [0, 0, 0, burst, 0, 0] });
    assert.equal(result.arrow.frozen, 0);
    assert.equal(result.arrow.backward, 0);
    assert.equal(result.player.backward, 0);
    assert.ok(result.player.frozen < 0.02, JSON.stringify(result.player));
    assert.ok(result.player.max < 0.014, JSON.stringify(result.player));
    assert.ok(result.arrow.max < 0.004, JSON.stringify(result.arrow));
    assert.ok(result.maxDelay > 125 && result.maxDelay <= 250);
    assert.ok(result.maxTimings <= 16);
  });
}

test("ordinary 70 ms jitter leaves nominal rate and base display delays unchanged", (context) => {
  const result = trace(context, { jitter: [0, 60, 0, 25, 0, 70] });
  assert.equal(result.transport.playerClock.rate, 1);
  assert.equal(result.transport.projectiles.clock.rate, 1);
  assert.equal(result.transport.playerClock.delay, 125);
  assert.equal(result.transport.projectiles.clock.delay, 100);
  assert.equal(result.player.frozen, 0);
  assert.equal(result.arrow.frozen, 0);
  assert.ok(Math.abs(result.player.max - 1 / 300) < 1e-8);
  assert.ok(Math.abs(result.player.min - 1 / 300) < 1e-8);
});

test("a slow authority returning to full speed drains no buffer or unbounded recovery lag", (context) => {
  const result = trace(context, {
    interval: 100,
    recovery: true,
    duration: 12000,
  });
  assert.equal(result.player.frozen, 0);
  assert.equal(result.arrow.frozen, 0);
  assert.equal(result.player.backward, 0);
  assert.equal(result.arrow.backward, 0);
  assert.ok(result.maxLag < 300, `recovery lag: ${result.maxLag} ms`);
  assert.equal(result.maxDelay, 125);
  assert.ok(Math.abs(result.transport.playerClock.rate - 1) < 0.001);
});

test("two-minute sessions keep timing history bounded across round epochs and a low render rate", (context) => {
  const result = trace(context, {
    duration: 120000,
    fps: 12,
    rounds: true,
    interval: 80,
  });
  assert.equal(result.player.backward, 0);
  assert.equal(result.arrow.backward, 0);
  assert.ok(result.player.frozen < 0.01, JSON.stringify(result.player));
  assert.equal(result.arrow.frozen, 0);
  assert.ok(result.maxTimings <= 16);
  assert.ok(result.transport.snapshots.length <= 8);
  assert.ok(result.transport.playerClock.epoch.startsWith("4:"));
});
