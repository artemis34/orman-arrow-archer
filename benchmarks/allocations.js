import { resolve } from "node:path";
import { modules } from "./workload.js";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const api = await modules(resolve(args.root || "."));
const value = [
  "events",
  Array.from({ length: 64 }, (_, i) => ({
    type: "hit",
    x: i / 7,
    z: -i / 11,
    amount: 15.3 + i / 19,
  })),
];
const raw = api.encodePacket(value),
  OriginalDataView = globalThis.DataView;
let count = 0;
globalThis.DataView = class extends OriginalDataView {
  constructor(...args) {
    super(...args);
    count++;
  }
};
let encodeViews, decodeViews, inputViews;
try {
  api.encodePacket(value);
  encodeViews = count;
  count = 0;
  api.decodePacket(raw);
  decodeViews = count;
  count = 0;
  api.decodeInputs(
    api.encodeInputs([{ seq: 1, x: 0.5, z: 1, angle: 0.2, charge: true }]),
  );
  inputViews = count;
} finally {
  globalThis.DataView = OriginalDataView;
}
const OriginalMap = globalThis.Map,
  originalNow = performance.now;
let maps = 0,
  now = 0,
  retainedMaps;
globalThis.Map = class extends OriginalMap {
  constructor(...args) {
    super(...args);
    maps++;
  }
};
Object.defineProperty(performance, "now", {
  configurable: true,
  value: () => now,
});
try {
  const transport = new api.NetworkTransport(
    () => {},
    () => {},
  );
  transport.id = "local";
  transport.obstacles = [];
  for (let i = 0; i < 120; i++) {
    now = (i * 1000) / 15;
    const players = Array.from({ length: 16 }, (_, j) => ({
      id: j ? `other-${j}` : "local",
      x: i / 100 + j,
      z: 0,
      angle: 0,
      alive: true,
      levelGuard: 0,
      upgrades: {},
      seq: i,
    }));
    transport.acceptState({
      players,
      arrows: [{ id: "a", x: i, z: 1, angle: 0 }],
    });
    for (let f = 0; f < 8; f++) {
      now += 1000 / 120;
      transport.view();
    }
  }
  retainedMaps = transport.snapshots.reduce(
    (sum, entry) =>
      sum + Object.values(entry).filter((v) => v instanceof OriginalMap).length,
    0,
  );
} finally {
  globalThis.Map = OriginalMap;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: originalNow,
  });
}
console.log(
  JSON.stringify({
    encodeFloatDataViews: encodeViews,
    decodeFloatDataViews: decodeViews,
    quantizedInputDataViews: inputViews,
    clientMaps: maps,
    clientViews: 960,
    retainedIndexMaps: retainedMaps,
  }),
);
