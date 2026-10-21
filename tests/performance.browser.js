import { chromium, webkit } from "@playwright/test";
import { createServer } from "vite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { annotateFailure } from "./report.js";

// Isolated renderer fixture: no production debug API and no reduced-quality preset.
// Assert GPU submission/resource budgets, not machine-dependent headless FPS.
const engine = process.env.PLAYWRIGHT_ENGINE || "chromium";
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
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
      deviceScaleFactor: 3,
      isMobile: touch,
      hasTouch: touch,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/__performance", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;overflow:hidden}canvas{display:block}</style><canvas></canvas>',
      }),
    );
    await page.goto(base + "/__performance");
    const result = await page.evaluate(async () => {
      const { ArenaScene } = await import("/client/scene.js");
      const { World } = await import("/shared/world.js");
      const { createMode } = await import("/shared/modes.js");
      const { RULES } = await import("/shared/config.js");
      const world = new World({ bots: 15, mode: createMode("t8") });
      world.addPlayer("local", "Gezgin", 0);
      let i = 0;
      for (const p of world.players.values()) {
        p.x = ((i % 4) - 1.5) * 3.2;
        p.z = (Math.floor(i / 4) - 1.5) * 3.4;
        p.spawnShield = 0;
        p.skin = i % 4;
        p.hp = 67 + i;
        p.maxHp = 150;
        p.charge = (i % 3) / 2;
        i++;
      }
      const me = world.players.get("local");
      me.x = 0;
      me.z = 0;
      const state = world.snapshot("local");
      for (let j = 0; j < 120; j++)
        state.arrows.push({
          id: j,
          x: ((j % 12) - 5.5) * 1.4,
          z: (Math.floor(j / 12) - 4.5) * 1.7,
          angle: j * 0.2,
          effect: ["normal", "frost", "blast", "poison"][j % 4],
          trail: "trail-leaf",
        });
      const scene = new ArenaScene(document.querySelector("canvas"));
      scene.setQuality("balanced");
      scene.setMap(world.obstacles);
      const gl = scene.renderer.getContext(),
        createBuffer = gl.createBuffer;
      let createdBuffers = 0,
        warmBuffers = 0;
      gl.createBuffer = function () {
        createdBuffers++;
        return createBuffer.call(this);
      };
      const lineDistance = scene.aimLine.geometry.attributes.lineDistance;
      scene.burst(0, 0, 0xffdd88, 140);
      const frames = [];
      for (let f = 0; f < 35; f++) {
        await new Promise(requestAnimationFrame);
        if (f % 10 === 0) scene.burst(0, 0, 0xffdd88, 140);
        state.players.forEach((p, j) => {
          p.angle = f * 0.02;
          p.x += (j % 2 ? 1 : -1) * 0.01;
          p.charge = (f % 30) / 30;
        });
        const start = performance.now();
        scene.render(state, "local", 1 / 60, true);
        if (f === 10) warmBuffers = createdBuffers;
        if (f >= 10)
          frames.push({
            ms: performance.now() - start,
            calls: scene.renderer.info.render.calls,
            triangles: scene.renderer.info.render.triangles,
          });
      }
      const before = { ...scene.renderer.info.memory };
      const steadyBuffers = createdBuffers - warmBuffers;
      const reusedAimBuffer =
        lineDistance === scene.aimLine.geometry.attributes.lineDistance;
      // Re-equipping, deaths/respawns and incoming players must not leak meshes/textures.
      for (let f = 0; f < 8; f++) {
        for (const p of state.players) {
          p.skin = (p.skin + 1) % 4;
          p.alive = f % 3 !== 0;
        }
        scene.render(state, "local", 1 / 60, true);
      }
      for (const p of state.players) p.alive = true;
      scene.render(state, "local", 1 / 60, true);
      const after = { ...scene.renderer.info.memory };
      const animation = {
        labels: [...scene.players.values()].filter(
          (v) => v.root.visible && v.label.visible,
        ).length,
        arrows: scene.arrows.shafts.count,
        heads: scene.arrows.headMeshes.reduce((n, m) => n + m.count, 0),
        gems: scene.gems.count,
        rare: scene.rareHalos.count,
        shadowCasters: [...scene.avatarBatches.batches.values()]
          .filter((b) => b.mesh.castShadow)
          .reduce((n, b) => n + b.mesh.count, 0),
      };
      const settings = {
        dpr: scene.renderer.getPixelRatio(),
        shadows: scene.renderer.shadowMap.enabled,
        shadowSize: scene.sun.shadow.mapSize.x,
      };
      scene.setQuality("high");
      scene.render(state, "local", 1 / 60, true);
      const high = {
        dpr: scene.renderer.getPixelRatio(),
        shadows: scene.renderer.shadowMap.enabled,
      };
      scene.setQuality("balanced");
      state.players[0].levelGuard = 3;
      scene.render(state, "local", 1 / 60, true);
      const guard = scene.players.get(state.players[0].id);
      const guardVisible =
        guard.levelEffect.visible &&
        guard.shield.visible &&
        guard.guardSparks.length === 6;
      return {
        players: state.players.length,
        rareExpected: RULES.maxRareOrbs,
        animation,
        settings,
        high,
        guardVisible,
        before,
        after,
        steadyBuffers,
        reusedAimBuffer,
        frames,
        contextLost: scene.renderer.getContext().isContextLost(),
      };
    });
    assert.equal(result.players, 16);
    assert.equal(result.animation.labels, 16);
    assert.equal(result.animation.arrows, 120);
    assert.equal(result.animation.heads, 120);
    assert.equal(result.animation.gems, 140);
    assert.equal(result.animation.rare, result.rareExpected);
    assert.ok(
      result.animation.shadowCasters >= 32,
      "all head/body shadows survive instancing",
    );
    assert.ok(
      result.frames.every((f) => f.calls < 160),
      `bounded draw calls with 16 archers, 120 arrows and all 140 particles: ${JSON.stringify(result.frames)}`,
    );
    assert.ok(
      result.frames.every((f) => f.triangles > 30000),
      "scenery/model geometry is retained",
    );
    assert.deepEqual(result.settings, {
      dpr: 1.5,
      shadows: true,
      shadowSize: touch ? 1024 : 2048,
    });
    assert.deepEqual(result.high, { dpr: 2, shadows: true });
    assert.equal(
      result.after.geometries,
      result.before.geometries,
      "no geometry growth on re-equips/respawns",
    );
    assert.equal(
      result.after.textures,
      result.before.textures,
      "no label texture growth on re-equips/respawns",
    );
    assert.equal(result.guardVisible, true);
    assert.equal(
      result.steadyBuffers,
      0,
      "steady frames allocate no new GPU buffers",
    );
    assert.equal(result.reusedAimBuffer, true);
    assert.equal(result.contextLost, false);
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `/tmp/archer-validation/performance-${engine}-${label}.png`,
    });
    const sorted = result.frames.map((f) => f.ms).sort((a, b) => a - b);
    const report = {
      ...result,
      frames: undefined,
      medianSubmissionMs: sorted[Math.floor(sorted.length / 2)],
      maxDrawCalls: Math.max(...result.frames.map((f) => f.calls)),
    };
    writeFileSync(
      `/tmp/archer-validation/performance-${engine}-${label}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(
      `PERFORMANCE_BROWSER_OK ${engine} ${label}: ${JSON.stringify(report)}`,
    );
    await page.close();
  }
} catch (error) {
  annotateFailure(error, "Renderer performance regression");
  throw error;
} finally {
  await browser.close();
  await server.close();
}
