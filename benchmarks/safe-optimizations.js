import { performance } from "node:perf_hooks";
import { cpuUsage, memoryUsage, version, platform, arch } from "node:process";
import { cpus } from "node:os";
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { SCENARIOS, modules, makeRoom, advance, publish } from "./workload.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const root = resolve(args.root || "."),
  repeats = Number(args.repeats || 5),
  label = args.label || "candidate";
if (!global.gc)
  throw new Error("Run node --expose-gc benchmarks/safe-optimizations.js");
const api = await modules(root),
  results = [];
const wallNow = performance.now.bind(performance);
function measure(id, run, units) {
  if (args.only && args.only !== id) return;
  for (let warm = 0; warm < Number(args.warmups || 1); warm++) run(() => {});
  const samples = [];
  for (let n = 0; n < repeats; n++) {
    global.gc();
    const before = memoryUsage();
    let peak = before.heapUsed;
    const sample = () => {
      peak = Math.max(peak, memoryUsage().heapUsed);
    };
    const cpu = cpuUsage(),
      start = wallNow(),
      result = run(sample);
    const wallMs = wallNow() - start,
      used = cpuUsage(cpu);
    sample();
    global.gc();
    const after = memoryUsage();
    const metrics = { ...result.metrics };
    // Keep the active component alive through retained-memory sampling.
    if (!result.retained) throw new Error("Missing retained component");
    result.retained = null;
    global.gc();
    const released = memoryUsage();
    samples.push({
      wallMs,
      cpuMs: (used.user + used.system) / 1000,
      heapPeakKiB: (peak - before.heapUsed) / 1024,
      heapRetainedKiB: (after.heapUsed - released.heapUsed) / 1024,
      rssMiB: after.rss / 1048576,
      externalKiB: after.external / 1024,
      ...metrics,
    });
  }
  const median = (key) => {
    const a = samples.map((x) => x[key]).sort((a, b) => a - b);
    return a[Math.floor(a.length / 2)];
  };
  const medians = Object.fromEntries(
    Object.keys(samples[0]).map((key) => [key, median(key)]),
  );
  results.push({ id, units, medians, samples });
  console.log(JSON.stringify({ label, id, ...medians }));
}
for (const scenario of SCENARIOS)
  measure(
    scenario.id,
    (sample) => {
      const room = makeRoom(api, scenario);
      let bytes = 0,
        messages = 0;
      for (let tick = 0; tick < scenario.seconds * 30; tick++) {
        advance(room, tick);
        if (tick % 2 === 1) {
          const sent = publish(api, room);
          bytes += sent.bytes;
          messages += sent.messages;
        }
        if (tick % 60 === 0) sample();
      }
      return { metrics: { bytes, messages }, retained: room };
    },
    {
      simulatedSeconds: scenario.seconds,
      humans: scenario.humans,
      bots: scenario.bots,
      tickHz: 30,
      snapshotHz: 15,
    },
  );

// Dense floating-point event packet: local scratch allocation can be measured
// independently of the predominantly quantized integer production snapshots.
const eventPacket = [
  "events",
  Array.from({ length: 64 }, (_, i) => ({
    type: "hit",
    x: i / 7,
    z: -i / 11,
    amount: 15.3 + i / 19,
  })),
];
const raw = api.encodePacket(eventPacket);
measure(
  "codec-floats",
  (sample) => {
    let bytes = 0;
    for (let i = 0; i < 1500; i++) {
      const packet = api.encodePacket(eventPacket);
      bytes += packet.byteLength;
      api.decodePacket(packet);
      if (i % 100 === 0) sample();
    }
    return { metrics: { bytes, messages: 1500 }, retained: raw };
  },
  {
    packets: 1500,
    floatFieldsPerPacket: eventPacket[1]
      .flatMap(Object.values)
      .filter((v) => typeof v === "number" && !Number.isSafeInteger(v)).length,
  },
);

if (!args.only || args.only === "client-view") {
  const room = makeRoom(api, SCENARIOS[1]),
    clientStates = [];
  for (let tick = 0; tick < 240; tick++) {
    advance(room, tick);
    if (tick % 2 === 1)
      publish(api, room, (state, packet, i) => {
        if (i === 0) clientStates.push(structuredClone(state));
      });
  }
  const actualNow = performance.now;
  let clock = 0;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => clock,
  });
  try {
    measure(
      "client-view",
      (sample) => {
        const transport = new api.NetworkTransport(
          () => {},
          () => {},
        );
        transport.id = "player-0";
        transport.obstacles = [];
        let views = 0,
          positionSum = 0;
        for (let cycle = 0; cycle < 8; cycle++)
          for (let i = 0; i < clientStates.length; i++) {
            clock = cycle * 8000 + (i * 1000) / 15;
            transport.acceptState(clientStates[i]);
            for (let frame = 0; frame < 8; frame++) {
              clock += 1000 / 120;
              const view = transport.view();
              positionSum += view.players[0].x;
              views++;
            }
            if (i % 30 === 0) sample();
          }
        return {
          metrics: { views, positionSum, bytes: 0, messages: 0 },
          retained: transport,
        };
      },
      { displayHz: 120, snapshotHz: 15, players: 16, views: 7680 },
    );
  } finally {
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: actualNow,
    });
  }
}
const report = {
  label,
  root,
  environment: {
    node: version,
    platform,
    arch,
    cpu: cpus()[0]?.model,
    repeats,
    warmups: Number(args.warmups || 1),
  },
  runtimeSha256: Object.fromEntries(
    [
      "shared/world.js",
      "shared/config.js",
      "shared/skills.js",
      "shared/spatial.js",
      "shared/protocol.js",
      "client/transport.js",
      "client/websocket.js",
      "cloudflare/worker.js",
      "server/index.js",
    ].map((path) => [
      path,
      createHash("sha256")
        .update(readFileSync(resolve(root, path)))
        .digest("hex"),
    ]),
  ),
  results,
};
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
