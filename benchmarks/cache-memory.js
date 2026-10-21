import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
if (!global.gc) throw new Error("Use --expose-gc");
const path = pathToFileURL(resolve(args.root || ".", "shared/protocol.js")),
  samples = [];
function fill(api, start, count) {
  for (let i = start; i < start + count; i++)
    api.encodePacket([String(i).padStart(128, "x")]);
}
for (let repeat = 0; repeat < 7; repeat++) {
  const api = await import(path.href + `?memory-sample=${repeat}`);
  for (let i = 0; i < 1500; i++) api.encodePacket(["warm".padEnd(128,"x")]);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  fill(api, 0, 512);
  global.gc();
  const filled = process.memoryUsage().heapUsed;
  fill(api, 512, 2048);
  global.gc();
  const later = process.memoryUsage().heapUsed;
  samples.push({
    retainedKiB: (filled - before) / 1024,
    additionalKiB: (later - filled) / 1024,
  });
}
const median = (key) =>
  samples.map((s) => s[key]).sort((a, b) => a - b)[
    Math.floor(samples.length / 2)
  ];
console.log(
  JSON.stringify({
    retainedKiB: median("retainedKiB"),
    additionalKiB: median("additionalKiB"),
    samples,
  }),
);
