import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Real RAF intervals, whole-page CPU sampling and GL traffic. Software WebGL
// results are comparative measurements, never a physical iPhone FPS claim.
const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || true];
  }),
);
const root = resolve(options.root || ".");
const output = resolve(options.out || "/tmp/wildbow-frame-pacing");
mkdirSync(output, { recursive: true });
const server = await createServer({
  root,
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [root, process.cwd()] },
  },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
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
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ||
    0
  );
}
try {
  for (const [label, width, height, touch] of [
    ["phone", 390, 844, true],
    ["desktop", 1280, 800, false],
  ]) {
    if (options.view && options.view !== label) continue;
    for (const scenario of ["fixture", "game"]) {
      if (options.scenario && options.scenario !== scenario) continue;
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 3,
        hasTouch: touch,
        isMobile: touch,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.__frameTraffic = { bytes: 0, draws: 0 };
        const prototype = WebGL2RenderingContext.prototype;
        const upload = prototype.bufferSubData;
        prototype.bufferSubData = function (
          target,
          offset,
          data,
          start = 0,
          length = 0,
        ) {
          window.__frameTraffic.bytes += length
            ? length * data.BYTES_PER_ELEMENT
            : data.byteLength;
          return upload.apply(this, arguments);
        };
        for (const key of [
          "drawElements",
          "drawArrays",
          "drawElementsInstanced",
          "drawArraysInstanced",
        ]) {
          const draw = prototype[key];
          prototype[key] = function (...args) {
            window.__frameTraffic.draws++;
            return draw.apply(this, args);
          };
        }
      });
      if (scenario === "fixture") {
        await page.route("**/__frame_fixture", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;overflow:hidden}canvas{display:block}</style><canvas></canvas>',
          }),
        );
        await page.goto(base + "/__frame_fixture");
        await page.evaluate(async (diagnostic) => {
          const { ArenaScene } = await import("/client/scene.js");
          const { World } = await import("/shared/world.js");
          const { createMode } = await import("/shared/modes.js");
          const world = new World({ bots: 15, mode: createMode("t8") });
          world.addPlayer("local", "Gezgin", 0);
          const state = world.snapshot("local");
          state.players.forEach((p, i) =>
            Object.assign(p, {
              x: ((i % 4) - 1.5) * 3.2,
              z: (Math.floor(i / 4) - 1.5) * 3.4,
              hp: 100,
              maxHp: 150,
              spawnShield: 0,
              charge: 0.5,
              buffType: i % 2 ? "haste" : "power",
              buffTime: 15,
            }),
          );
          Object.assign(
            state.players.find((p) => p.id === "local"),
            { x: 0, z: 0 },
          );
          state.arrows = Array.from({ length: 120 }, (_, i) => ({
            id: i,
            x: ((i % 12) - 5.5) * 1.4,
            z: (Math.floor(i / 12) - 4.5) * 1.7,
            angle: i * 0.2,
            effect: ["normal", "frost", "blast", "poison"][i % 4],
            trail: "trail-leaf",
          }));
          const scene = new ArenaScene(document.querySelector("canvas"));
          scene.setQuality("balanced");
          scene.setMap(world.obstacles);
          let frame = 0,
            last = performance.now();
          function draw(now) {
            const dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            state.players.forEach((p, i) => {
              p.angle = frame * 0.02;
              if (p.id !== "local") p.x += (i % 2 ? 1 : -1) * 0.01;
              p.charge = (frame % 30) / 30;
              if (frame % 8 === 0) p.hp = 80 + ((frame + i) % 60);
            });
            if (frame++ % 10 === 0) scene.burst(0, 0, 0xffdd88, 140);
            scene.render(state, "local", dt, true);
            // Attribution experiment only, never a production quality setting.
            if (diagnostic === "freeze-shadows")
              scene.sun.shadow.autoUpdate = false;
            requestAnimationFrame(draw);
          }
          requestAnimationFrame(draw);
          window.__fixtureScene = scene;
        }, options.diagnostic || null);
      } else {
        await page.goto(base);
        await page.locator("#practice-mode").click();
        await page.locator("#play").click();
        await page.locator("#hud").waitFor({ state: "visible" });
        if (!touch) await page.keyboard.down("d");
      }
      await page.waitForTimeout(1500);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
      const before = (await cdp.send("Performance.getMetrics")).metrics;
      const samples = await page.evaluate(
        async (seconds) => {
          const values = [];
          let previous = performance.now();
          const end = previous + seconds * 1000;
          while (performance.now() < end) {
            const now = await new Promise(requestAnimationFrame);
            values.push({ ms: now - previous, ...window.__frameTraffic });
            previous = now;
            window.__frameTraffic.bytes = window.__frameTraffic.draws = 0;
          }
          return values.slice(1);
        },
        Number(options.seconds || 6),
      );
      const after = (await cdp.send("Performance.getMetrics")).metrics;
      const { profile } = await cdp.send("Profiler.stop");
      const nodes = new Map(
        profile.nodes.map((node) => [node.id, node.callFrame]),
      );
      const weights = new Map();
      (profile.samples || []).forEach((id, i) => {
        const node = nodes.get(id);
        const key = `${node.functionName || "anonymous"} ${node.url?.replace(base, "")}:${node.lineNumber + 1}`;
        weights.set(
          key,
          (weights.get(key) || 0) + (profile.timeDeltas?.[i] || 0),
        );
      });
      const metrics = {};
      for (const metric of after) {
        const old = before.find((m) => m.name === metric.name)?.value || 0;
        if (
          [
            "ScriptDuration",
            "LayoutDuration",
            "RecalcStyleDuration",
            "TaskDuration",
            "JSHeapUsedSize",
          ].includes(metric.name)
        )
          metrics[metric.name] = {
            before: old,
            after: metric.value,
            delta: metric.value - old,
          };
      }
      const report = {
        label,
        scenario,
        diagnostic: options.diagnostic || null,
        root,
        seconds: samples.reduce((n, s) => n + s.ms, 0) / 1000,
        frames: samples.length,
        fps: (1000 * samples.length) / samples.reduce((n, s) => n + s.ms, 0),
        medianFrameMs: percentile(
          samples.map((s) => s.ms),
          0.5,
        ),
        p95FrameMs: percentile(
          samples.map((s) => s.ms),
          0.95,
        ),
        slowFramesOver25Ms: samples.filter((s) => s.ms > 25).length,
        medianUploadBytes: percentile(
          samples.map((s) => s.bytes),
          0.5,
        ),
        medianDrawCalls: percentile(
          samples.map((s) => s.draws),
          0.5,
        ),
        metrics,
        topCpu: [...weights].sort((a, b) => b[1] - a[1]).slice(0, 25),
        errors,
      };
      writeFileSync(
        `${output}/${label}-${scenario}.json`,
        JSON.stringify(report, null, 2),
      );
      writeFileSync(
        `${output}/${label}-${scenario}.cpuprofile`,
        JSON.stringify(profile),
      );
      await page.screenshot({ path: `${output}/${label}-${scenario}.png` });
      console.log(JSON.stringify(report));
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
