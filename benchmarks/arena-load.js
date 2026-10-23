import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const root = resolve(args.root || ".");
const read = (file) => import(pathToFileURL(resolve(root, file)));
const [{ ArenaRoom }, { World }, { SnapshotEncoder }] = await Promise.all([
  read("cloudflare/worker.js"),
  read("shared/world.js"),
  read("shared/protocol.js"),
]);
const repeats = Number(args.repeats || 5),
  reports = [];
if (!global.gc) throw new Error("Run with node --expose-gc");
for (const humans of [2, 8, 16]) {
  const samples = [];
  for (let repeat = -1; repeat < repeats; repeat++) {
    global.gc();
    const before = process.memoryUsage();
    const room = new ArenaRoom(
      { getWebSockets: () => [], waitUntil: () => {} },
      {},
    );
    room.world = new World({ bots: Math.max(0, 8 - humans) });
    let bytes = 0,
      messages = 0;
    for (let i = 0; i < humans; i++) {
      const id = `human-${i}`;
      room.world.addPlayer(id, `Player ${i}`);
      room.sessions.set(
        {
          send: (packet) => {
            bytes += packet.byteLength || Buffer.byteLength(packet);
            messages++;
          },
        },
        {
          id,
          joined: true,
          lastInput: Date.now(),
          inputs: [],
          encoder: new SnapshotEncoder(),
        },
      );
    }
    const start = process.cpuUsage(),
      ticks = [];
    const memoryStart = process.memoryUsage().heapUsed;
    let peak = memoryStart;
    for (let tick = 0; tick < 660; tick++) {
      for (const session of room.sessions.values()) {
        const p = room.world.players.get(session.id);
        if (!p.alive && p.respawnAt <= room.world.time)
          room.world.respawn(p.id);
        if (p.choices.length) room.world.choose(p.id, p.choices[0]);
        session.lastInput = Date.now();
        session.inputs.push({
          seq: tick + 1,
          x: Math.cos(tick / 100),
          z: Math.sin(tick / 100),
          autoFire: true,
          angle: tick / 100,
        });
      }
      const at = performance.now();
      room.step();
      ticks.push(performance.now() - at);
      if (tick % 60 === 0)
        peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    const cpu = process.cpuUsage(start);
    global.gc();
    ticks.sort((a, b) => a - b);
    if (repeat >= 0)
      samples.push({
        medianTickMs: ticks[Math.floor(ticks.length / 2)],
        p95TickMs: ticks[Math.floor(ticks.length * 0.95)],
        cpuMsPerSimSecond: (cpu.user + cpu.system) / 1000 / 22,
        heapRetainedKiB:
          (process.memoryUsage().heapUsed - before.heapUsed) / 1024,
        peakGrowthKiB: (peak - memoryStart) / 1024,
        bytesPerSecond: bytes / 22,
        messagesPerSecond: messages / 22,
      });
  }
  const median = Object.fromEntries(
    Object.keys(samples[0]).map((key) => [
      key,
      samples.map((s) => s[key]).sort((a, b) => a - b)[
        Math.floor(samples.length / 2)
      ],
    ]),
  );
  const report = { humans, bots: Math.max(0, 8 - humans), median, samples };
  reports.push(report);
  console.log(JSON.stringify({ humans, ...median }));
}
if (args.out)
  writeFileSync(
    args.out,
    JSON.stringify(
      { root, repeats, runtime: process.version, reports },
      null,
      2,
    ) + "\n",
  );
