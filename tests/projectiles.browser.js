import { chromium, webkit } from "@playwright/test";
import { createServer } from "vite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

// Real WebGL transforms from authoritative world snapshots + the shipped v2
// codec. The simulated clock isolates packet jitter from headless GPU speed.
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(engine === "chromium"
    ? {
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
      }
    : {}),
});
mkdirSync("/tmp/archer-validation", { recursive: true });
try {
  for (const [label, width, height, touch] of [
    ["phone", 390, 844, true],
    ["desktop", 1280, 800, false],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: touch,
      hasTouch: touch,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/__projectiles", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{display:block}</style><canvas></canvas>',
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/__projectiles`,
    );
    const result = await page.evaluate(async () => {
      const { ArenaScene } = await import("/client/scene.js");
      const { NetworkTransport, LocalTransport } =
        await import("/client/transport.js");
      const { SnapshotEncoder, SnapshotDecoder } =
        await import("/shared/protocol.js");
      const { World } = await import("/shared/world.js");
      const world = new World({ bots: 0 });
      world.obstacles = [];
      world.obstacleGrid.clear();
      const me = world.addPlayer("me");
      Object.assign(me, { x: -25, z: 0, charge: 1, angle: 0 });
      world.fire(me);
      const encoder = new SnapshotEncoder(),
        decoder = new SnapshotDecoder(),
        queue = [];
      let arrival = 0;
      for (let tick = 0; tick < 60; tick++) {
        world.step();
        if (tick % 2) {
          const state = decoder.decode(encoder.encode(world.snapshot("me")));
          arrival = Math.max(
            arrival + 1,
            state.time * 1000 + 60 + [0, 60, 0, 25, 0, 70][queue.length % 6],
          );
          queue.push({ at: arrival, state });
        }
      }
      const transport = new NetworkTransport(
        () => {},
        () => {},
      );
      transport.id = "me";
      transport.obstacles = [];
      const original = performance.now.bind(performance);
      let now = 0;
      Object.defineProperty(performance, "now", {
        configurable: true,
        value: () => now,
      });
      const samples = [],
        poses = [];
      let final;
      try {
        for (let frame = 0; frame < 230; frame++) {
          now = (frame * 1000) / 120;
          while (queue.length && queue[0].at <= now) {
            const event = queue.shift(),
              frameAt = now;
            now = event.at;
            transport.acceptState(event.state);
            now = frameAt;
          }
          const view = transport.view();
          const arrow = view?.arrows[0];
          if (arrow && now > 450 && now < 1150) samples.push(arrow.x);
          if (arrow && now > 550 && poses.length < 12) poses.push(view);
          final = view;
        }
      } finally {
        Object.defineProperty(performance, "now", {
          configurable: true,
          value: original,
        });
      }
      const scene = new ArenaScene(document.querySelector("canvas"));
      scene.setMap([]);
      const matrix = scene.arrows.dummy.matrix.clone();
      let maxMatrixError = 0;
      for (const view of poses) {
        await new Promise(requestAnimationFrame);
        scene.render(view, "me", 1 / 120, true);
        scene.arrows.shafts.getMatrixAt(0, matrix);
        maxMatrixError = Math.max(
          maxMatrixError,
          Math.abs(matrix.elements[12] - view.arrows[0].x),
        );
        if (scene.arrows.shafts.count !== 1)
          throw new Error("projectile mesh disappeared");
      }
      scene.render(final, "me", 1 / 120, true);
      const removedCount = scene.arrows.shafts.count;
      const local = new LocalTransport();
      local.world.obstacles = [];
      local.world.obstacleGrid.clear();
      local.world.players.clear();
      const actor = local.world.addPlayer(local.id);
      Object.assign(actor, { x: -5, z: 0, charge: 1, angle: 0 });
      local.world.fire(actor);
      local.step({});
      local.step({});
      const localPositions = [];
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        await new Promise(requestAnimationFrame);
        scene.render(local.view(fraction), local.id, 1 / 120, true);
        scene.arrows.shafts.getMatrixAt(0, matrix);
        localPositions.push(matrix.elements[12]);
      }
      const steps = samples.slice(1).map((x, i) => x - samples[i]);
      return {
        engine: navigator.userAgent,
        frames: steps.length,
        frozen: steps.filter((x) => Math.abs(x) < 0.001).length,
        minStep: Math.min(...steps),
        maxStep: Math.max(...steps),
        maxMatrixError,
        removedCount,
        localPositions,
        contextLost: scene.renderer.getContext().isContextLost(),
      };
    });
    assert.ok(result.frames > 60);
    assert.equal(result.frozen, 0);
    assert.ok(
      result.minStep > 0 && result.maxStep < 0.45,
      JSON.stringify(result),
    );
    assert.ok(result.maxMatrixError < 0.00001);
    assert.equal(result.removedCount, 0);
    assert.ok(result.localPositions.every((x, i, a) => !i || x > a[i - 1]));
    assert.equal(result.contextLost, false);
    assert.deepEqual(errors, []);
    writeFileSync(
      `/tmp/archer-validation/projectiles-${engine}-${label}.json`,
      JSON.stringify(result, null, 2),
    );
    await page.screenshot({
      path: `/tmp/archer-validation/projectiles-${engine}-${label}.png`,
    });
    console.log(
      `PROJECTILE_RENDER_OK ${engine} ${label} ${JSON.stringify(result)}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
