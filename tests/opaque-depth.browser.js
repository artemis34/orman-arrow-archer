import { chromium, webkit } from "@playwright/test";
import { createServer } from "vite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  for (const [label, width, height, touch] of [
    ["phone", 390, 844, true],
    ["desktop", 1280, 800, false],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: touch,
      isMobile: touch,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/__opaque_depth", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{display:block}</style><canvas></canvas>',
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/__opaque_depth`,
    );
    const result = await page.evaluate(async () => {
      const { ArenaScene } = await import("/client/scene.js");
      const { World } = await import("/shared/world.js");
      const { prioritizeStaticOccluders } =
        await import("/client/static-occluders.js");
      const world = new World({ bots: 7 });
      Object.assign(world.addPlayer("local", "Gezgin"), { x: 0, z: 0 });
      const state = world.snapshot("local");
      for (const p of state.players) {
        p.spawnShield = 3;
        p.hp = 100;
      }
      const scene = new ArenaScene(document.querySelector("canvas"));
      scene.renderer.setPixelRatio(1);
      scene.renderer.setSize(innerWidth, innerHeight);
      scene.setMap(world.obstacles);
      const gl = scene.renderer.getContext();
      const statics = [
        ...scene.staticGroup.children,
        ...scene.worldGroup.children,
      ];
      const indexedGeometries = statics.map((mesh) => mesh.geometry);
      // Expanding the shipped indices recreates the old GPU face stream. Node
      // coverage separately compares pre-merge transforms and exact attributes.
      const expandedGeometries = indexedGeometries.map((geometry) =>
        geometry.index ? geometry.toNonIndexed() : geometry.clone(),
      );
      const geometryStats = (geometries) =>
        geometries.reduce(
          (result, geometry) => {
            result.vertices += geometry.attributes.position.count;
            result.triangles +=
              (geometry.index?.count ?? geometry.attributes.position.count) / 3;
            result.bytes += Object.values(geometry.attributes).reduce(
              (sum, attribute) => sum + attribute.array.byteLength,
              geometry.index?.array.byteLength || 0,
            );
            return result;
          },
          { vertices: 0, triangles: 0, bytes: 0 },
        );
      const shippedEarlyMeshes = statics.filter(
        (mesh) => mesh.renderOrder === -1,
      ).length;
      const originalSettings = statics.map((mesh) => [
        mesh,
        mesh.material.depthWrite,
        mesh.castShadow,
        mesh.geometry.attributes.position.count,
      ]);
      const pixels = () => {
        scene.render(state, "local", 0, true);
        const data = new Uint8Array(innerWidth * innerHeight * 4);
        gl.readPixels(
          0,
          0,
          innerWidth,
          innerHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          data,
        );
        return data;
      };
      const shadowPixels = () => {
        const target = scene.sun.shadow.map;
        const data = new Uint8Array(target.width * target.height * 4);
        scene.renderer.readRenderTargetPixels(
          target,
          0,
          0,
          target.width,
          target.height,
          data,
        );
        return data;
      };
      const difference = (reference, current) => {
        let changed = 0,
          highDifference = 0,
          sum = 0,
          max = 0;
        for (let i = 0; i < current.length; i += 4) {
          let error = 0;
          for (let c = 0; c < 4; c++) {
            const delta = Math.abs(current[i + c] - reference[i + c]);
            sum += delta;
            error = Math.max(error, delta);
          }
          if (error) changed++;
          if (error > 4) highDifference++;
          max = Math.max(max, error);
        }
        return {
          changedPixels: changed,
          highDifferencePixels: highDifference,
          highDifferenceFraction: highDifference / (current.length / 4),
          meanError: sum / current.length,
          maxError: max,
        };
      };
      const comparisons = [];
      const indexedComparisons = [];
      for (const [x, z] of [
        [0, 0],
        [0.07, 0.07],
        [-12, 12],
        [-11.93, 12.07],
        [31, -29],
        [31.07, -28.93],
      ]) {
        const me = state.players.find((p) => p.id === "local");
        Object.assign(me, { x, z });
        scene.target.set(x, 0, z);
        const avatar = scene.players.get("local");
        if (avatar) {
          avatar.root.position.set(x, 0, z);
          Object.assign(avatar.pose, { x, z });
        }
        for (const mesh of statics) mesh.renderOrder = 0;
        const reference = pixels();
        prioritizeStaticOccluders(scene.staticGroup);
        prioritizeStaticOccluders(scene.worldGroup, scene.forestMats.trail);
        const current = pixels();
        comparisons.push({
          x,
          z,
          ...difference(reference, current),
        });
        const currentShadow = shadowPixels();
        const indexedCalls = scene.renderer.info.render.calls;
        const indexedTriangles = scene.renderer.info.render.triangles;
        for (let i = 0; i < statics.length; i++)
          statics[i].geometry = expandedGeometries[i];
        const expanded = pixels();
        const expandedShadow = shadowPixels();
        indexedComparisons.push({
          x,
          z,
          pixels: difference(expanded, current),
          shadows: difference(expandedShadow, currentShadow),
          indexedCalls,
          expandedCalls: scene.renderer.info.render.calls,
          indexedTriangles,
          expandedTriangles: scene.renderer.info.render.triangles,
        });
        for (let i = 0; i < statics.length; i++)
          statics[i].geometry = indexedGeometries[i];
      }
      const indexedGeometry = geometryStats(indexedGeometries);
      const expandedGeometry = geometryStats(expandedGeometries);
      for (const geometry of expandedGeometries) geometry.dispose();
      return {
        shippedEarlyMeshes,
        comparisons,
        indexedComparisons,
        indexedGeometry,
        expandedGeometry,
        earlyMeshes: statics.filter((m) => m.renderOrder === -1).length,
        unchangedGeometryDepthAndShadows: originalSettings.every(
          ([m, depth, shadow, vertices]) =>
            m.material.depthWrite === depth &&
            m.castShadow === shadow &&
            m.geometry.attributes.position.count === vertices,
        ),
        glError: gl.getError(),
        contextLost: gl.isContextLost(),
      };
    });
    writeFileSync(
      `/tmp/archer-validation/opaque-depth-${engine}-${label}.json`,
      JSON.stringify(result, null, 2),
    );
    await page.screenshot({
      path: `/tmp/archer-validation/opaque-depth-${engine}-${label}.png`,
    });
    assert.ok(result.earlyMeshes > 0);
    assert.equal(result.shippedEarlyMeshes, result.earlyMeshes);
    assert.equal(result.unchangedGeometryDepthAndShadows, true);
    for (const sample of result.comparisons) {
      assert.ok(sample.meanError < 0.05, JSON.stringify(sample));
      assert.ok(sample.highDifferenceFraction < 0.0002, JSON.stringify(sample));
    }
    assert.equal(
      result.indexedGeometry.triangles,
      result.expandedGeometry.triangles,
    );
    assert.ok(result.indexedGeometry.bytes < result.expandedGeometry.bytes);
    for (const sample of result.indexedComparisons) {
      assert.equal(sample.pixels.changedPixels, 0, JSON.stringify(sample));
      assert.equal(sample.shadows.changedPixels, 0, JSON.stringify(sample));
      assert.equal(sample.indexedCalls, sample.expandedCalls);
      assert.equal(sample.indexedTriangles, sample.expandedTriangles);
    }
    assert.equal(result.glError, 0);
    assert.equal(result.contextLost, false);
    assert.deepEqual(errors, []);
    console.log(
      `OPAQUE_DEPTH_OK ${engine} ${label}: ${JSON.stringify(result)}`,
    );
    await page.close();
  }
} catch (error) {
  annotateFailure(
    error,
    "Static scene geometry, shadow and occluder regression",
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
