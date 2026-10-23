import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const { NetworkTransport } = await import(
  pathToFileURL(resolve(args.root || ".", "client/transport.js"))
);
const previousNow = performance.now;
let now = 0;
Object.defineProperty(performance, "now", {
  configurable: true,
  value: () => now,
});
try {
  const transport = new NetworkTransport(
    () => {},
    () => {},
  );
  transport.id = "viewer";
  transport.obstacles = [];
  const packets = [];
  const jitter = [0, 25, -15, 40, -5, 10, 35, -10];
  for (let i = 0; i < 120; i++) {
    const time = i / 15;
    packets.push({
      at: time * 1000 + 80 + jitter[i % jitter.length],
      state: {
        time,
        players: [{ id: "remote", x: time * 3, z: 0, angle: 0, alive: true }],
        arrows: [],
      },
    });
  }
  packets.sort((a, b) => a.at - b.at);
  let next = 0,
    previous = null;
  const steps = [];
  for (let frame = 0; frame < 470; frame++) {
    now = (frame * 1000) / 60;
    while (next < packets.length && packets[next].at <= now)
      transport.acceptState(packets[next++].state);
    const x = transport.view()?.players[0].x;
    if (now >= 1000 && x != null && previous != null) steps.push(x - previous);
    previous = x;
  }
  const speed = steps.map((step) => step * 60);
  const mean = speed.reduce((sum, n) => sum + n, 0) / speed.length;
  const deviations = speed.map((n) => Math.abs(n - 3)).sort((a, b) => a - b);
  const report = {
    fixture:
      "15Hz snapshots, 60Hz display, constant 3 units/s, 65-120ms arrival delay",
    frames: steps.length,
    meanSpeed: mean,
    speedStdDev: Math.sqrt(
      speed.reduce((sum, n) => sum + (n - mean) ** 2, 0) / speed.length,
    ),
    p95SpeedError: deviations[Math.floor(deviations.length * 0.95)],
    stationaryFrames: steps.filter((n) => n <= 1e-10).length,
    backwardFrames: steps.filter((n) => n < -1e-8).length,
    largestStep: Math.max(...steps),
  };
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: previousNow,
  });
}
