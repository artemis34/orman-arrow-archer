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
  const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/__bowpose", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<canvas id="arena"></canvas><style>body{margin:0}</style>',
    }),
  );
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__bowpose`,
  );
  const result = await page.evaluate(async () => {
    const { ArenaScene } = await import("/client/scene.js");
    const { World } = await import("/shared/world.js");
    const scene = new ArenaScene(document.querySelector("canvas"));
    const w = new World({ bots: 0 });
    const me = w.addPlayer("me");
    Object.assign(me, { x: 0, z: 0, spawnShield: 0, levelGuard: 0 });
    scene.setMap([]);
    scene.autoFire = true;
    const render = () => scene.render(w.snapshot("me"), "me", 1 / 60, true);
    render();
    const v = scene.players.get("me"),
      initial = v.arm.position.x;
    me.charge = 1;
    for (let i = 0; i < 40; i++) render();
    const drawn = {
      draw: v.bowPose.draw,
      arm: v.arm.position.x,
      string: v.string.geometry.attributes.position.getX(1),
      visible: v.nockedArrow.visible,
    };
    me.charge = 0;
    me.shotCd = 0.65;
    render();
    const released = {
      recoil: v.bowPose.recoil,
      visible: v.nockedArrow.visible,
      release: v.bowPose.release,
    };
    me.autoTargetId = "enemy";
    for (let i = 0; i < 36; i++) {
      me.shotCd = Math.max(0, me.shotCd - 1 / 60);
      render();
    }
    const autoDraw = v.bowPose.draw;
    // Close-up is for inspecting the actual game rig; no production debug API.
    scene.camera.position.set(3.8, 3.5, 4.2);
    scene.camera.lookAt(0, 1, 0);
    scene.renderer.render(scene.scene, scene.camera);
    return { initial, drawn, released, autoDraw };
  });
  assert.ok(result.drawn.draw > 0.99);
  assert.ok(result.drawn.arm < result.initial - 0.3);
  assert.ok(result.drawn.string < -0.6);
  assert.equal(result.drawn.visible, true);
  assert.equal(result.released.recoil, 1);
  assert.ok(result.released.release > 0);
  assert.equal(result.released.visible, false);
  assert.ok(result.autoDraw > 0.4);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: `/tmp/archer-validation/bow-draw-${engine}.png`,
  });
  console.log("BOW_POSE_BROWSER_OK " + engine + " " + JSON.stringify(result));
} catch (error) {
  annotateFailure(error, "Bow draw and release");
  throw error;
} finally {
  await browser.close();
  await server.close();
}
