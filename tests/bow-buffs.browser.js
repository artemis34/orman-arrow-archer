import { chromium, webkit } from "@playwright/test";
import { createServer } from "vite";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { annotateFailure } from "./report.js";

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
  const page = await browser.newPage({
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await page.route("**/__bow-buffs", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;overflow:hidden}canvas{display:block}</style><canvas></canvas>',
    }),
  );
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__bow-buffs`,
  );
  const result = await page.evaluate(async () => {
    const { ArenaScene } = await import("/client/scene.js");
    const { World } = await import("/shared/world.js");
    const world = new World({ bots: 0 });
    const camera = world.addPlayer("camera", ""),
      power = world.addPlayer("power", "HASAR +%20"),
      haste = world.addPlayer("haste", "ATIŞ HIZI +%30");
    Object.assign(camera, { x: 0, z: 0, alive: false });
    for (const p of [power, haste])
      Object.assign(p, {
        x: p === power ? -1.9 : 1.9,
        z: 0,
        spawnShield: 0,
        levelGuard: 0,
        buffType: p.id,
        buffTime: 15,
        angle: -0.25,
        charge: 0.4,
      });
    const state = world.snapshot("camera");
    state.orbs = [];
    state.powerups = [];
    state.objective = null;
    const scene = new ArenaScene(document.querySelector("canvas"));
    scene.setMap([]);
    // Presentation-only close-up. These are the actual shipped meshes/shaders,
    // not a mock-up or a debug endpoint on the game server.
    scene.camera.zoom = 3.7;
    scene.camera.updateProjectionMatrix();
    scene.render(state, "camera", 1 / 60, true);
    const counts = () => [
      scene.bowBuffs.fire.count,
      scene.bowBuffs.lightning.count,
    ];
    const active = counts();
    const gl = scene.renderer.getContext(),
      original = gl.createBuffer;
    let created = 0;
    gl.createBuffer = function () {
      created++;
      return original.call(this);
    };
    const memory = { ...scene.renderer.info.memory };
    const fireMatrix = new Float32Array(
      scene.bowBuffs.fire.instanceMatrix.array.slice(0, 16),
    );
    for (let i = 0; i < 12; i++) {
      state.players.find((p) => p.id === "power").angle += 0.06;
      scene.render(state, "camera", 1 / 60, true);
    }
    const turned = scene.bowBuffs.fire.instanceMatrix.array
      .slice(0, 16)
      .some((v, i) => Math.abs(v - fireMatrix[i]) > 0.01);
    const steadyBuffers = created;
    for (const p of state.players) p.buffTime = 0;
    scene.render(state, "camera", 1 / 60, true);
    const expired = counts();
    for (const p of state.players) p.buffTime = 15;
    state.players.find((p) => p.id === "power").alive = false;
    scene.render(state, "camera", 1 / 60, true);
    const death = counts();
    state.players = state.players.filter((p) => p.id !== "haste");
    scene.render(state, "camera", 1 / 60, true);
    const hidden = counts();
    state.players = world.snapshot("camera").players;
    for (const p of state.players)
      if (p.id !== "camera") Object.assign(p, { angle: -0.25, buffTime: 15 });
    scene.render(state, "camera", 1 / 60, true);
    const after = { ...scene.renderer.info.memory };
    // Isolated test fixture only: lets screenshot capture advance the same GPU
    // animation deterministically without exposing a production app debug API.
    window.previewFrame = (time) => {
      scene.time = time - 1 / 60;
      scene.render(state, "camera", 1 / 60, true);
    };
    return {
      active,
      expired,
      death,
      hidden,
      turned,
      steadyBuffers,
      memory,
      after,
      contextLost: gl.isContextLost(),
    };
  });
  assert.deepEqual(result.active, [1, 1]);
  assert.deepEqual(result.expired, [0, 0]);
  assert.deepEqual(result.death, [0, 1]);
  assert.deepEqual(result.hidden, [0, 0]);
  assert.equal(result.turned, true);
  assert.equal(result.steadyBuffers, 0);
  assert.deepEqual(result.after, result.memory);
  assert.equal(result.contextLost, false);
  await page.evaluate(() => window.previewFrame(1.1));
  await page.screenshot({
    path: `/tmp/archer-validation/bow-buffs-${engine}.png`,
  });
  if (process.env.CAPTURE_BOW_PREVIEW === "1") {
    mkdirSync("/tmp/wildbow-bow-frames", { recursive: true });
    for (let i = 0; i < 40; i++) {
      await page.evaluate((time) => window.previewFrame(time), i / 20);
      await page.screenshot({
        path: `/tmp/wildbow-bow-frames/${String(i).padStart(3, "0")}.png`,
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    `BOW_BUFFS_OK ${engine}: animated fire/electricity, current bow transforms, authoritative expiry, death/camouflage and zero steady GPU allocations`,
  );
} catch (error) {
  annotateFailure(error, "Bow buff visuals");
  throw error;
} finally {
  await browser.close();
  await server.close();
}
