import test from "node:test";
import assert from "node:assert/strict";
import { RenderCadence } from "../client/render-cadence.js";

function run(
  displayRate,
  targetRate,
  seconds = 10,
  jitter = () => 0,
  timestampQuantum = 0,
) {
  const cadence = new RenderCadence();
  const times = [];
  for (let frame = 0; frame < displayRate * seconds; frame++) {
    const timestamp = (frame * 1000) / displayRate + jitter(frame);
    const now = timestampQuantum
      ? Math.floor(timestamp / timestampQuantum) * timestampQuantum
      : timestamp;
    if (cadence.due(now, targetRate)) times.push(now);
  }
  return times;
}

/** Gaps after the short measuring phase, in display refreshes. */
function refreshGaps(times, displayRate, skip = 10) {
  const refresh = 1000 / displayRate;
  return times
    .slice(skip)
    .map((at, i, list) => (i ? Math.round((at - list[i - 1]) / refresh) : 0))
    .slice(1);
}

test("every drawn frame is evenly spaced on 60, 90, 120, 144 and 240 Hz screens", () => {
  for (const [display, expected] of [
    [60, 1],
    [75, 1],
    [90, 1],
    [120, 2],
    [144, 2],
    [165, 2],
    [240, 4],
  ]) {
    const gaps = refreshGaps(run(display, 60), display);
    assert.ok(gaps.length > 100, `${display} Hz`);
    assert.ok(
      gaps.every((g) => g === expected),
      `${display} Hz draws every ${expected} refresh(es)`,
    );
  }
});

test("90 Hz phones keep full 90 FPS instead of alternating 1- and 2-refresh frames", () => {
  const times = run(90, 60, 10);
  assert.ok(times.length >= 895);
});

test("120 Hz and 240 Hz displays submit 60 frames per second during play", () => {
  for (const display of [120, 240]) {
    const times = run(display, 60);
    assert.ok(Math.abs(times.length - 600) <= 2, `${display} Hz`);
  }
});

test("idle lobby pacing stays near 30 FPS and evenly spaced", () => {
  for (const [display, expected] of [
    [60, 2],
    [90, 3],
    [120, 4],
  ]) {
    const gaps = refreshGaps(run(display, 30), display);
    assert.ok(
      gaps.every((g) => g === expected),
      `${display} Hz idle`,
    );
  }
});

test("1–2 ms timestamps and refresh jitter do not break the divisor", () => {
  for (const quantum of [1, 2]) {
    const gaps = refreshGaps(
      run(120, 60, 20, (i) => (i % 2 ? 0.14 : -0.11), quantum),
      120,
    );
    assert.ok(
      gaps.every((g) => g === 2),
      `${quantum} ms`,
    );
  }
  const jitter = [-0.18, 0.2, -0.12, 0.1, -0.07, 0.19];
  const gaps = refreshGaps(
    run(60, 60, 20, (i) => jitter[i % jitter.length]),
    60,
  );
  assert.ok(gaps.every((g) => g === 1));
});

test("a slow display or slow renderer is never reduced further", () => {
  assert.equal(run(24, 60).length, 240);
  assert.equal(run(40, 60).length, 400);
});

test("mode changes render immediately", () => {
  const cadence = new RenderCadence();
  for (let i = 0; i < 20; i++) cadence.due(i * 8.333, 60);
  assert.equal(cadence.due(20 * 8.333, 30), true);
  assert.equal(cadence.due(21 * 8.333, 60), true);
});

test("reset and a backwards clock restart measurement and draw", () => {
  const cadence = new RenderCadence();
  for (let i = 0; i < 20; i++) cadence.due(1000 + i * 8.333, 60);
  assert.equal(cadence.due(0, 60), true);
  cadence.reset();
  assert.equal(cadence.due(50000), true);
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
