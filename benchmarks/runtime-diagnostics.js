import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SnapshotDecoder, PROTOCOL } from "../shared/protocol.js";
import { annotateFailure } from "../tests/report.js";

// Exercise the published client and separately measure a renderer-free socket.
// Headless software-GPU FPS is deliberately labelled; it is not iPhone FPS.
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);
const base =
  args.base || process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const seconds = Math.max(10, Math.min(180, Number(args.seconds) || 45));
const output = args.out || "/tmp/archer-validation/runtime-diagnostics.json";
mkdirSync(dirname(output), { recursive: true });
const percentile = (values, p) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
    : null;
};
const summary = (values) => ({
  count: values.length,
  median: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  max: values.length ? Math.max(...values) : null,
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function networkResult(samples, rtts) {
  const intervals = samples.slice(1).map((p, i) => p.at - samples[i].at);
  const first = samples[0],
    last = samples.at(-1);
  const duration = last && first ? last.at - first.at : 0;
  return {
    snapshots: samples.length,
    arrivalHz: duration > 0 ? ((samples.length - 1) * 1000) / duration : null,
    simulationSpeed:
      duration > 0 ? ((last.time - first.time) * 1000) / duration : null,
    inferredTickHz:
      duration > 0 ? ((last.time - first.time) * 30000) / duration : null,
    intervalMs: summary(intervals),
    gapsOver150ms: intervals.filter((n) => n > 150).length,
    rttMs: summary(rtts),
    population: last?.population ?? null,
  };
}
async function socketProbe() {
  const url = new URL(`/api/rooms/diag-net-${Date.now().toString(36)}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const decoder = new SnapshotDecoder(),
    samples = [],
    rtts = [];
  let id,
    sequence = 0,
    pendingPing = null,
    inputTimer,
    pingTimer;
  const ping = () => {
    if (ws.readyState !== 1 || pendingPing !== null) return;
    pendingPing = performance.now();
    ws.send(JSON.stringify({ type: "ping" }));
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Raw WebSocket welcome timed out")),
        15000,
      );
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Raw WebSocket failed"));
      });
      ws.addEventListener("open", () =>
        ws.send(
          JSON.stringify({
            type: "join",
            data: { name: "Network diagnostic", skin: 0, protocol: PROTOCOL },
          }),
        ),
      );
      ws.addEventListener("message", ({ data }) => {
        const packet =
          typeof data === "string"
            ? JSON.parse(data)
            : { type: "state", data: decoder.decode(data) };
        if (packet.type === "welcome") {
          id = packet.data.id;
          clearTimeout(timer);
          inputTimer = setInterval(() => {
            if (ws.readyState === 1)
              ws.send(
                JSON.stringify({
                  type: "input",
                  data: { seq: ++sequence, x: 0, z: 0, angle: 0 },
                }),
              );
          }, 1000 / 30);
          ping();
          pingTimer = setInterval(ping, 2000);
          resolve();
        } else if (packet.type === "pong" && pendingPing !== null) {
          rtts.push(performance.now() - pendingPing);
          pendingPing = null;
        } else if (packet.type === "state") {
          samples.push({
            at: performance.now(),
            time: packet.data.time,
            population:
              packet.data.roster?.length || packet.data.players.length,
          });
        }
      });
    });
    await wait(seconds * 1000);
    if (!id || samples.length < 10)
      throw new Error("Raw WebSocket received too few states");
    return networkResult(samples, rtts);
  } finally {
    clearInterval(inputTimer);
    clearInterval(pingTimer);
    ws.close(1000, "diagnostic complete");
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium")
      ? "/usr/bin/chromium"
      : chromium.executablePath()),
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const errors = [],
    samples = [],
    rtts = [];
  let pingAt = null,
    welcomeId = null;
  const decoder = new SnapshotDecoder();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        if (JSON.parse(payload).type === "ping") pingAt = performance.now();
      } catch {}
    });
    socket.on("framereceived", ({ payload }) => {
      try {
        const packet =
          typeof payload === "string"
            ? JSON.parse(payload)
            : { type: "state", data: decoder.decode(payload) };
        if (packet.type === "welcome") welcomeId = packet.data.id;
        if (packet.type === "pong" && pingAt !== null) {
          rtts.push(performance.now() - pingAt);
          pingAt = null;
        }
        if (packet.type === "state")
          samples.push({
            at: performance.now(),
            time: packet.data.time,
            population:
              packet.data.roster?.length || packet.data.players.length,
          });
      } catch {}
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("wildbow-performance", "true");
    const trace = (window.__renderDiagnostic = {
      active: false,
      draws: 0,
      frames: [],
      longTasks: [],
    });
    for (const key of [
      "drawElements",
      "drawArrays",
      "drawElementsInstanced",
      "drawArraysInstanced",
    ]) {
      const original = WebGL2RenderingContext.prototype[key];
      WebGL2RenderingContext.prototype[key] = function (...parameters) {
        if (this.canvas.id === "arena") trace.draws++;
        return original.apply(this, parameters);
      };
    }
    const native = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      native((at) => {
        const before = trace.draws;
        callback(at);
        if (trace.active && !document.hidden && trace.draws > before)
          trace.frames.push(performance.now());
      });
    try {
      new PerformanceObserver((entries) => {
        if (trace.active)
          trace.longTasks.push(...entries.getEntries().map((e) => e.duration));
      }).observe({ type: "longtask", buffered: false });
    } catch {}
  });
  await page.goto(
    `${base}/?room=diag-ui-${Date.now().toString(36)}&format=arena`,
    { waitUntil: "commit" },
  );
  await page.locator("#lobby").waitFor({ state: "visible", timeout: 30000 });
  const clientAsset = await page
    .locator('script[type="module"][src]')
    .first()
    .getAttribute("src");
  await page.locator("#online-mode").click();
  // A private diagnostic room prevents interfering with public matchmaking.
  if (await page.locator("#friend-room").count())
    await page.locator("#friend-room").click();
  if (await page.locator("#room-code").isVisible())
    await page.locator("#room-code").fill(`diag-ui-${Date.now().toString(36)}`);
  await page.locator("#play").click();
  await page.locator("#hud").waitFor({ state: "visible", timeout: 18000 });
  await page.waitForFunction(
    () => document.querySelector("#connection")?.textContent === "ONLINE",
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(5000);
  samples.length = 0;
  rtts.length = 0;
  await page.evaluate(() => {
    window.__renderDiagnostic.frames = [];
    window.__renderDiagnostic.longTasks = [];
    window.__renderDiagnostic.active = true;
  });
  const rawPromise = socketProbe();
  const overlaySamples = [];
  // Keep the real solo match running; recover through normal controls.
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const measured = await page.evaluate(() => {
      const element = document.getElementById("performance-monitor");
      if (!element || element.classList.contains("hidden")) return null;
      return Object.fromEntries(
        Object.entries(element.dataset).map(([key, value]) => [
          key,
          value === "" ? null : Number(value),
        ]),
      );
    });
    if (measured) overlaySamples.push(measured);
    if (await page.locator("#death").isVisible()) {
      if (await page.locator("#respawn").isEnabled())
        await page.locator("#respawn").click();
    } else if (
      await page.locator("#upgrade-options button").first().isVisible()
    ) {
      await page.locator("#upgrade-options button").first().click();
    }
    await page.waitForTimeout(500);
  }
  const rawSocket = await rawPromise;
  const trace = await page.evaluate(() => {
    window.__renderDiagnostic.active = false;
    return window.__renderDiagnostic;
  });
  const intervals = trace.frames.slice(1).map((at, i) => at - trace.frames[i]);
  const displayed = {};
  for (const key of [
    "fps",
    "p95Ms",
    "jank",
    "pingMs",
    "snapshotAgeMs",
    "arrivalHz",
    "simulationRatio",
    "jitterMs",
    "maxArrivalGapMs",
  ])
    displayed[key] = summary(
      overlaySamples.map((sample) => sample[key]).filter(Number.isFinite),
    );
  const result = {
    label: args.label || "measurement",
    base,
    measuredAt: new Date().toISOString(),
    seconds,
    hardware:
      "Headless Chromium, SwiftShader software GPU; not a physical iPhone",
    clientAsset,
    render: {
      frames: trace.frames.length,
      fps: intervals.length
        ? (intervals.length * 1000) / (trace.frames.at(-1) - trace.frames[0])
        : null,
      frameMs: summary(intervals),
      jankOver50ms: intervals.filter((n) => n > 50).length,
      longTasksMs: summary(trace.longTasks),
    },
    displayed,
    browserNetwork: networkResult(samples, rtts),
    rawSocket,
    welcome: !!welcomeId,
    errors,
  };
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  await page.screenshot({ path: output.replace(/\.json$/, ".png") });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_ACTIONS === "true")
    console.log(
      `::notice title=Wildbow runtime measurements::${JSON.stringify(result).replaceAll("%", "%25").replaceAll("\n", "%0A")}`,
    );
  if (errors.length || !welcomeId || intervals.length < 10)
    throw new Error(
      "Diagnostic session did not render a healthy connected match",
    );
} catch (error) {
  annotateFailure(error, "Runtime diagnostics");
  throw error;
} finally {
  await browser.close();
}
