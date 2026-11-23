import test from "node:test";
import assert from "node:assert/strict";
import { NetworkTransport } from "../client/transport.js";
import { RULES } from "../shared/config.js";

let clock = 0;
Object.defineProperty(globalThis, "performance", {
  value: { now: () => clock },
  configurable: true,
});

/** Per-frame walking speed of the predicted local archer at 60 FPS. */
function walk(sendTick) {
  const t = new NetworkTransport(
    () => {},
    () => {},
  );
  t.send = () => {};
  t.id = "me";
  t.obstacles = [];
  t.predicted = {
    id: "me",
    x: -41,
    z: 0,
    alive: true,
    dashCd: 0,
    dashTime: 0,
    angle: 0,
    upgrades: {},
  };
  const frame = 1000 / 60,
    speeds = [];
  let last = null;
  for (clock = 0; clock < 9000; clock += frame) {
    sendTick(t);
    const x = t.localPose(clock).x;
    if (last !== null && clock > 500) speeds.push((x - last) / (frame / 1000));
    last = x;
  }
  return speeds;
}

test("scheduled input ticks keep the local archer's on-screen speed constant", () => {
  const interval = 1000 / RULES.tick;
  let due = 0;
  const speeds = walk((t) => {
    // Each frame sends every due tick stamped with its scheduled time.
    for (; clock >= due; due += interval) t.step({ x: 1, z: 0, angle: 0 }, due);
  });
  for (const speed of speeds) assert.ok(Math.abs(speed - RULES.speed) < 0.01);
});

test("timer-stamped ticks (the old behaviour) visibly stutter under jitter", () => {
  const interval = 1000 / RULES.tick;
  let next = 0,
    seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const speeds = walk((t) => {
    // A busy main thread runs the 30 Hz timer a few milliseconds late.
    for (
      ;
      clock >= next;
      next = Math.max(next + interval, clock) + random() * 6
    )
      t.step({ x: 1, z: 0, angle: 0 });
  });
  const stalls = speeds.filter((speed) => speed < RULES.speed / 2).length;
  assert.ok(stalls > 0, "the comparison must expose the old stutter");
});
