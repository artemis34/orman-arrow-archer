import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { createMode } from "../shared/modes.js";
import { selectTarget } from "../shared/aim.js";
import { presentationTarget } from "../client/auto-target.js";
const reports = [];
for (const count of [8, 16, 32]) {
  const world = new World({ bots: 0, mode: createMode("br") }),
    me = world.addPlayer("viewer");
  Object.assign(me, { x: 0, z: 0, spawnShield: 0 });
  for (let i = 1; i < count; i++) {
    const p = world.addPlayer("p" + i, "Target", 0, true);
    Object.assign(p, {
      x: Math.cos(i) * 12,
      z: Math.sin(i) * 12,
      hp: 10 + i,
      spawnShield: 0,
    });
  }
  const players = [...world.players.values()];
  const target = selectTarget(me, players, world.obstacles);
  assert.ok(target);
  me.autoTargetId = target.id;
  const calls = 10000,
    results = {};
  for (const [name, fn] of [
    ["fullSearch", selectTarget],
    ["authorityTarget", presentationTarget],
  ]) {
    for (let i = 0; i < 500; i++) fn(me, players, world.obstacles);
    const times = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      let result;
      for (let n = 0; n < calls; n++) result = fn(me, players, world.obstacles);
      times.push(performance.now() - start);
      assert.equal(result, target);
    }
    times.sort((a, b) => a - b);
    results[name] = {
      medianMs: times[2],
      microsecondsPerCall: (times[2] * 1000) / calls,
    };
  }
  reports.push({ players: players.length, calls, ...results });
}
const report = {
  runtime: process.version,
  scope: "Local CPU microbenchmark, not whole-game or physical-device FPS",
  reports,
};
if (process.env.BENCH_OUTPUT)
  writeFileSync(process.env.BENCH_OUTPUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
