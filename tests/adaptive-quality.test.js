import test from "node:test";
import assert from "node:assert/strict";
import { AdaptiveQuality, QUALITY_STEPS } from "../client/adaptive-quality.js";
import { RenderCadence } from "../client/render-cadence.js";

const feed = (quality, interval, expected, frames) => {
  const steps = [];
  for (let i = 0; i < frames; i++) {
    const step = quality.observe(interval(i), expected);
    if (step !== null) steps.push([i, step]);
  }
  return steps;
};

test("a phone holding its frame rate keeps full balanced quality", () => {
  const q = new AdaptiveQuality();
  // Occasional late frames are normal and never lower quality.
  const steps = feed(q, (i) => (i % 10 ? 16.7 : 33.3), 16.7, 3000);
  assert.deepEqual(steps, []);
  assert.equal(q.step, 0);
});

test("sustained dropped frames lower one step at a time, never below the last", () => {
  const q = new AdaptiveQuality();
  const steps = feed(q, (i) => (i % 2 ? 33.3 : 16.7), 16.7, 3000);
  assert.deepEqual(
    steps.map(([, step]) => step),
    [1, 2],
  );
  // Warm-up window + two slow windows before the first change.
  assert.equal(steps[0][0], 90 * 3 - 1);
  assert.equal(q.step, QUALITY_STEPS.length - 1);
});

test("stalls such as a tab switch are ignored", () => {
  const q = new AdaptiveQuality();
  assert.deepEqual(
    feed(q, () => 900, 16.7, 1000),
    [],
  );
});

test("a saved step is restored and clamped", () => {
  assert.equal(new AdaptiveQuality(1).step, 1);
  assert.equal(new AdaptiveQuality(9).step, QUALITY_STEPS.length - 1);
  assert.equal(new AdaptiveQuality(-3).step, 0);
  assert.equal(new AdaptiveQuality("x").step, 0);
});

test("a 30 FPS power-saving cap is not mistaken for a slow GPU", () => {
  const capped = new RenderCadence();
  for (let i = 0; i < 30; i++) capped.due(i * 33.3, 60);
  assert.ok(Math.abs(capped.expectedInterval(60) - 33.3) < 0.5);
  const dropping = new RenderCadence();
  for (let i = 0, t = 0; i < 30; i++)
    dropping.due((t += i % 2 ? 33.3 : 16.7), 60);
  assert.ok(Math.abs(dropping.expectedInterval(60) - 1000 / 60) < 0.5);
  const fast = new RenderCadence();
  for (let i = 0; i < 30; i++) fast.due(i * 8.333, 60);
  assert.ok(Math.abs(fast.expectedInterval(60) - 1000 / 60) < 0.01);
});
