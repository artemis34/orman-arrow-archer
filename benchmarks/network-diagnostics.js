import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PROTOCOL, SnapshotDecoder } from "../shared/protocol.js";
import { annotateFailure } from "../tests/report.js";

// Rendering-free probes distinguish network/room latency from GPU/main-thread stalls.
// Status reads do not join or alter the existing public match.
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const seconds = Math.max(
  10,
  Math.min(120, Number(process.env.PROBE_SECONDS) || 60),
);
const output =
  process.env.PROBE_OUTPUT || "/tmp/archer-validation/network-diagnostics.json";
const summarize = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const at = (p) =>
    sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : null;
  return { count: sorted.length, median: at(0.5), p95: at(0.95), max: at(1) };
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function httpProbe() {
  const results = [];
  for (const path of [
    "/health",
    "/api/rooms/brduo-wildbow-1/status?format=brduo",
  ]) {
    const times = [],
      colos = new Set();
    let body;
    for (let i = 0; i < 8; i++) {
      const start = performance.now();
      const response = await fetch(new URL(path, base), {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(`HTTP probe ${path}: ${response.status}`);
      body = await response.json();
      times.push(performance.now() - start);
      const colo = response.headers.get("cf-ray")?.split("-").at(-1);
      if (colo) colos.add(colo);
      await wait(250);
    }
    results.push({
      path,
      rttMs: summarize(times),
      ingressColos: [...colos],
      status: body,
    });
  }
  return results;
}
async function socketProbe(publicQueue = false) {
  let room = `net-${Date.now().toString(36)}`,
    ticket;
  if (publicQueue) {
    const response = await fetch(new URL("/api/matchmake", base), {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Public allocation: ${response.status}`);
    const allocation = await response.json();
    room = allocation.room;
    ticket = allocation.ticket;
  }
  const address = new URL(`/api/rooms/${room}`, base);
  if (ticket) address.searchParams.set("ticket", ticket);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(address);
  socket.binaryType = "arraybuffer";
  const decoder = new SnapshotDecoder(),
    rtts = [],
    states = [];
  let pingAt = null,
    inputTimer,
    pingTimer,
    seq = 0;
  const ping = () => {
    if (socket.readyState !== 1 || pingAt !== null) return;
    pingAt = performance.now();
    socket.send(JSON.stringify({ type: "ping" }));
  };
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Socket probe welcome timeout")),
        15000,
      );
      socket.addEventListener("error", () => {
        clearTimeout(deadline);
        reject(new Error("Socket probe connection failed"));
      });
      socket.addEventListener("open", () =>
        socket.send(
          JSON.stringify({
            type: "join",
            data: { name: "Latency probe", protocol: PROTOCOL },
          }),
        ),
      );
      socket.addEventListener("message", ({ data }) => {
        const packet =
          typeof data === "string"
            ? JSON.parse(data)
            : { type: "state", data: decoder.decode(data) };
        if (packet.type === "welcome") {
          clearTimeout(deadline);
          inputTimer = setInterval(() => {
            if (socket.readyState === 1)
              socket.send(
                JSON.stringify({
                  type: "input",
                  data: { seq: ++seq, x: 0, z: 0, angle: 0 },
                }),
              );
          }, 1000 / 30);
          ping();
          pingTimer = setInterval(ping, 1000);
          resolve();
        } else if (packet.type === "pong" && pingAt !== null) {
          rtts.push(performance.now() - pingAt);
          pingAt = null;
        } else if (packet.type === "state")
          states.push({ at: performance.now(), time: packet.data.time });
      });
    });
    await wait(seconds * 1000);
    if (states.length < 10 || !rtts.length)
      throw new Error("Socket probe received insufficient data");
    const elapsed = states.at(-1).at - states[0].at;
    const intervals = states.slice(1).map((s, i) => s.at - states[i].at);
    return {
      room,
      seconds,
      rttMs: summarize(rtts),
      arrivalHz: ((states.length - 1) * 1000) / elapsed,
      simulationRatio: ((states.at(-1).time - states[0].time) * 1000) / elapsed,
      intervalMs: summarize(intervals),
      gapsOver150ms: intervals.filter((ms) => ms > 150).length,
    };
  } finally {
    clearInterval(inputTimer);
    clearInterval(pingTimer);
    socket.close();
  }
}
try {
  const [http, socket, publicSocket] = await Promise.all([
    httpProbe(),
    socketProbe(),
    socketProbe(true),
  ]);
  const result = {
    measuredAt: new Date().toISOString(),
    base,
    location: "CI runner network, not the player's iPhone or carrier",
    http,
    socket,
    publicSocket,
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_ACTIONS === "true")
    console.log(
      `::notice title=Rendering-free network measurements::${JSON.stringify(result).replaceAll("%", "%25").replaceAll("\n", "%0A")}`,
    );
} catch (error) {
  annotateFailure(error, "Rendering-free network diagnostics");
  throw error;
}
