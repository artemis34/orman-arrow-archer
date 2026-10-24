import test from "node:test";
import assert from "node:assert/strict";
import { FrameCadence, NetworkCadence } from "../client/performance-monitor.js";

test("render cadence retains real stalls instead of the simulation's clamped dt", () => {
  const frames = new FrameCadence();
  for (const at of [0, 16, 32, 48, 64, 264]) frames.record(at);
  const result = frames.read(264);
  assert.equal(result.fps, (5 * 1000) / 264);
  assert.equal(result.p95Ms, 200);
  assert.equal(result.jank, 1);
});

test("rolling statistics recover after an old stall leaves the three second window", () => {
  const frames = new FrameCadence();
  frames.record(0);
  frames.record(200);
  for (let at = 220; at <= 3240; at += 20) frames.record(at);
  assert.deepEqual(frames.read(3240), { fps: 50, p95Ms: 20, jank: 0 });
});

test("a visibility or session reset excludes the time spent away", () => {
  const frames = new FrameCadence();
  frames.record(0);
  frames.record(16);
  frames.reset();
  frames.record(10000);
  assert.equal(frames.read(10000), null);
  frames.record(10016);
  assert.deepEqual(frames.read(10016), { fps: 62.5, p95Ms: 16, jank: 0 });
});

test("duplicate or invalid timestamps cannot create infinite FPS", () => {
  const frames = new FrameCadence();
  for (const at of [0, 0, NaN, 20, 20]) frames.record(at);
  assert.deepEqual(frames.read(20), { fps: 50, p95Ms: 20, jank: 0 });
  frames.record(1);
  assert.equal(frames.read(1), null, "a clock restart starts a fresh window");
});

const snapshot = (at, time, match) => ({
  at,
  state: { time, ...(match ? { match } : {}) },
});

test("practice, pending RTT and an actual measured zero remain distinguishable", () => {
  const cadence = new NetworkCadence();
  const transport = {
    online: true,
    ping: 0,
    snapshots: [snapshot(100, 10)],
  };
  cadence.record(transport, 120);
  assert.deepEqual(cadence.read({ online: false }, 120), { online: false });
  let result = cadence.read(transport, 120);
  assert.equal(result.pingMs, null);
  assert.equal(result.ageMs, 20, "snapshot age never substitutes for RTT");
  transport.pingMeasuredAt = 110;
  result = cadence.read(transport, 120);
  assert.equal(result.pingMs, 0, "a real measured zero is valid");
  assert.equal(result.pingAgeMs, 10);
  transport.ping = null;
  assert.equal(cadence.read(transport, 120).pingMs, null);
});

test("steady slow server time is distinguishable from irregular packet arrival", () => {
  const cadence = new NetworkCadence();
  const transport = { online: true, ping: null, snapshots: [] };
  for (let i = 0; i < 35; i++) {
    transport.snapshots.push(snapshot(i * 80, i / 15));
    while (transport.snapshots.length > 8) transport.snapshots.shift();
    cadence.record(transport, i * 80);
  }
  const result = cadence.read(transport, 2730);
  assert.equal(result.arrivalHz, 12.5);
  assert.equal(result.jitterMs, 0);
  assert.ok(Math.abs(result.simulationRatio - 5 / 6) < 1e-9);
  assert.ok(Math.abs(result.serverStepMs - 1000 / 15) < 1e-9);
  assert.equal(result.maxArrivalGapMs, 80);
  assert.equal(result.ageMs, 10);
});

test("arrival jitter and long gaps are measured independently of simulation time", () => {
  const cadence = new NetworkCadence();
  const transport = {
    online: true,
    ping: 42,
    pingMeasuredAt: 0,
    snapshots: [snapshot(0, 0), snapshot(50, 0.05), snapshot(200, 0.1)],
  };
  cadence.record(transport, 220);
  const result = cadence.read(transport, 220);
  assert.equal(result.arrivalHz, 10);
  assert.equal(result.jitterMs, 50);
  assert.equal(result.maxArrivalGapMs, 150);
  assert.equal(
    result.simulationRatio,
    null,
    "short windows do not claim a rate",
  );
  assert.equal(cadence.read(transport, 16000).pingStale, true);
});

test("round changes and a new transport discard unrelated simulation clocks", () => {
  const cadence = new NetworkCadence();
  const transport = {
    online: true,
    snapshots: [snapshot(100, 50), snapshot(200, 50.1)],
  };
  cadence.record(transport, 200);
  transport.snapshots.push(snapshot(300, 0, { round: 2, phase: "playing" }));
  cadence.record(transport, 300);
  assert.equal(cadence.read(transport, 300).arrivalHz, null);
  const next = { online: true, snapshots: [snapshot(350, 3)] };
  cadence.record(next, 360);
  assert.equal(cadence.read(next, 360).arrivalHz, null);
  assert.equal(cadence.read(next, 360).ageMs, 10);
});
