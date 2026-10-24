import test from "node:test";
import assert from "node:assert/strict";
import { RenderCadence } from "../client/render-cadence.js";

function run(displayRate, targetRate, seconds = 10, jitter = () => 0) {
  const cadence = new RenderCadence();
  const times = [];
  for (let frame = 0; frame < displayRate * seconds; frame++) {
    const now = (frame * 1000) / displayRate + jitter(frame);
    if (cadence.due(now, targetRate)) times.push(now);
  }
  return times;
}

test("120 Hz and 144 Hz displays submit only 60 render frames per second", () => {
  for (const display of [120, 144]) {
    const times = run(display, 60);
    assert.equal(times.length, 600, `${display} Hz`);
    assert.ok(times.every((at, i) => !i || at > times[i - 1]));
  }
});

test("60 Hz refresh jitter does not halve display cadence or accumulate drift", () => {
  const jitter = [-0.18, 0.2, -0.12, 0.1, -0.07, 0.19];
  const times = run(60, 60, 60, (i) => jitter[i % jitter.length]);
  assert.equal(times.length, 3600);
  for (let i = 1; i < times.length; i++)
    assert.ok(times[i] - times[i - 1] < 18);
});

test("120 Hz input with jitter produces evenly spaced 60 Hz render samples", () => {
  const times = run(120, 60, 10, (i) => (i % 2 ? 0.14 : -0.11));
  assert.equal(times.length, 600);
  for (let i = 1; i < times.length; i++)
    assert.ok(Math.abs(times[i] - times[i - 1] - 1000 / 60) < 0.3);
});

test("30 Hz idle pacing stays regular at both 60 Hz and 120 Hz", () => {
  for (const display of [60, 120]) {
    const times = run(display, 30, 10, (i) => (i % 3 ? 0.1 : -0.1));
    assert.equal(times.length, 300);
    for (let i = 1; i < times.length; i++)
      assert.ok(Math.abs(times[i] - times[i - 1] - 1000 / 30) < 0.3);
  }
});

test("slow rendering never queues catch-up draws or reduces an already slow display", () => {
  assert.equal(run(24, 60).length, 240);
  const cadence = new RenderCadence();
  assert.equal(cadence.due(0), true);
  assert.equal(cadence.due(200), true);
  assert.equal(cadence.due(200), false);
  assert.equal(cadence.due(201), false);
  assert.equal(cadence.due(208.333), false);
  assert.equal(cadence.due(216.667), true);
});

test("mode changes render immediately without keeping idle scheduling debt", () => {
  const cadence = new RenderCadence();
  assert.equal(cadence.due(0, 30), true);
  assert.equal(cadence.due(8, 30), false);
  assert.equal(cadence.due(16, 60), true);
  assert.equal(cadence.due(24, 60), false);
  assert.equal(cadence.due(32.667, 60), true);
  assert.equal(cadence.due(40, 30), true);
  assert.equal(cadence.due(56, 30), false);
});

test("reset and a backwards clock discard old deadlines", () => {
  const cadence = new RenderCadence();
  assert.equal(cadence.due(1000), true);
  assert.equal(cadence.due(1008), false);
  assert.equal(cadence.due(0), true);
  cadence.reset();
  assert.equal(cadence.due(50000), true);
  assert.equal(cadence.due(50008), false);
});

test("invalid timing values do not poison a running schedule", () => {
  const cadence = new RenderCadence();
  assert.equal(cadence.due(0), true);
  for (const [at, rate] of [
    [NaN, 60],
    [Infinity, 60],
    [8, 0],
    [8, NaN],
  ])
    assert.equal(cadence.due(at, rate), false);
  assert.equal(cadence.due(16.667), true);
});
