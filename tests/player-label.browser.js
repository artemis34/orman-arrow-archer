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
  const page = await browser.newPage({
    viewport: { width: 720, height: 800 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/__player_labels", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><style>body{margin:0;background:#567b55;color:white;font:12px sans-serif}canvas{display:block}</style><canvas id="gpu"></canvas>',
    }),
  );
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__player_labels`,
  );
  const result = await page.evaluate(async () => {
    const { createPlayerLabel } = await import("/client/player-label.js");
    // evaluate() itself does not resolve bare package imports.
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { TEAMS } = await import("/shared/modes.js");
    const renderer = new THREE.WebGLRenderer({
      canvas: document.querySelector("#gpu"),
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0, 0);
    const gl = renderer.getContext();
    gl.disable(gl.DITHER);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.9, 1.9, 0.6, -0.6, 0.1, 100);
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);
    let textureUploads = 0;
    for (const name of ["texImage2D", "texSubImage2D"]) {
      const upload = gl[name];
      gl[name] = function (...args) {
        textureUploads++;
        return upload.apply(this, args);
      };
    }

    // Independent reference: the original canvas name and HP rectangles. The
    // production helper never supplies either the expected pixels or colours.
    function canvasLabel(player, local) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 80;
      const ctx = canvas.getContext("2d");
      ctx.textAlign = "center";
      ctx.font = "600 22px sans-serif";
      const team = TEAMS[player.team];
      if (team) {
        ctx.fillStyle = team.color;
        ctx.fillText(`${team.symbol} ${local ? "Sen" : player.name}`, 128, 27);
      } else if (!local) {
        ctx.fillStyle = "#eef3dc";
        ctx.shadowColor = "#142c20";
        ctx.shadowBlur = 7;
        ctx.fillText(player.name, 128, 27);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = "#192e22";
      ctx.fillRect(64, 44, 128, 8);
      ctx.fillStyle =
        player.hp < player.maxHp * 0.3 ? "#e6a181" : team?.color || "#bde08d";
      ctx.fillRect(64, 44, (128 * player.hp) / player.maxHp, 8);
      const tex = new THREE.CanvasTexture(canvas);
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          depthTest: false,
          transparent: true,
        }),
      );
      label.scale.set(3.8, 1.2, 1);
      return { label, tex };
    }

    function pixels(label, width, height) {
      renderer.setSize(width, height);
      scene.add(label);
      renderer.render(scene, camera);
      const data = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      scene.remove(label);
      return data;
    }

    function compare(expected, actual, width, height) {
      let sum = 0,
        max = 0,
        nameSum = 0,
        nameSamples = 0,
        alphaMax = 0,
        highDifferencePixels = 0,
        paintedPixels = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          let pixelMax = 0;
          if (actual[offset + 3]) paintedPixels++;
          for (let channel = 0; channel < 4; channel++) {
            const delta = Math.abs(
              expected[offset + channel] - actual[offset + channel],
            );
            sum += delta;
            max = Math.max(max, delta);
            pixelMax = Math.max(pixelMax, delta);
            if (channel === 3) alphaMax = Math.max(alphaMax, delta);
            // readPixels is bottom-up. The top 39 canvas rows contain only
            // the name, safely separated from the bar's mip-filter footprint.
            if (y + 0.5 > (height * 41) / 80) {
              nameSum += delta;
              nameSamples++;
            }
          }
          if (pixelMax > 4) highDifferencePixels++;
        }
      }
      return {
        meanError: sum / actual.length,
        maxError: max,
        nameMeanError: nameSum / nameSamples,
        alphaMaxError: alphaMax,
        highDifferencePixels,
        highDifferenceFraction: highDifferencePixels / (width * height),
        paintedPixels,
      };
    }

    function image(data, width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const flipped = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++)
        flipped.data.set(
          data.subarray((height - y - 1) * width * 4, (height - y) * width * 4),
          y * width * 4,
        );
      ctx.putImageData(flipped, 0, 0);
      return canvas;
    }

    const cases = [
      { name: "solo-empty", fraction: 0 },
      { name: "solo-low", fraction: 0.125 },
      { name: "solo-fractional", fraction: 0.3333 },
      { name: "solo-healthy", fraction: 0.8 },
      { name: "solo-full", fraction: 1 },
      { name: "local-solo", fraction: 0.8, local: true },
      { name: "team-blue", fraction: 0.8, team: 1 },
      { name: "team-low", fraction: 0.125, team: 1 },
      { name: "local-team", fraction: 1, team: 2, local: true },
    ];
    const comparison = document.createElement("canvas");
    comparison.width = 700;
    comparison.height = cases.length * 3 * 100 + 30;
    const ctx = comparison.getContext("2d");
    ctx.fillStyle = "#567b55";
    ctx.fillRect(0, 0, comparison.width, comparison.height);
    ctx.fillStyle = "white";
    ctx.font = "12px sans-serif";
    ctx.fillText("Canvas reference", 172, 18);
    ctx.fillText("GPU health", 440, 18);
    const comparisons = [],
      noUploadChanges = [];
    let row = 0;
    for (const [width, height] of [
      [256, 80],
      [128, 40],
      [64, 20],
    ]) {
      for (const sample of cases) {
        const player = {
          name: "Robin",
          hp: 150 * sample.fraction,
          maxHp: 150,
          team: sample.team,
        };
        const reference = canvasLabel(player, sample.local);
        const view = createPlayerLabel(player, sample.local);
        view.label.position.set(0, 0, 0);
        const expected = pixels(reference.label, width, height);
        const actual = pixels(view.label, width, height);
        const metrics = compare(expected, actual, width, height);
        comparisons.push({ sample: sample.name, width, height, ...metrics });
        const y = 30 + row++ * 100;
        ctx.fillStyle = "white";
        ctx.fillText(`${sample.name} ${width}×${height}`, 8, y + 40);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image(expected, width, height), 172, y, 256, 80);
        ctx.drawImage(image(actual, width, height), 440, y, 256, 80);

        // Render the same already-uploaded helper again after a genuine HP
        // change. No name/team changes are involved, so texture traffic must
        // stay zero while the actual GPU output follows the new HP value.
        const version = view.tex.version;
        const nextPlayer = {
          ...player,
          hp: sample.fraction === 0.125 ? 120 : 18.75,
        };
        textureUploads = 0;
        view.update(nextPlayer);
        const changedPixels = pixels(view.label, width, height);
        const uploadsAfterHealth = textureUploads;
        const nextReference = canvasLabel(nextPlayer, sample.local);
        const nextExpected = pixels(nextReference.label, width, height);
        noUploadChanges.push({
          sample: sample.name,
          width,
          height,
          textureVersionUnchanged: view.tex.version === version,
          textureUploads: uploadsAfterHealth,
          ...compare(nextExpected, changedPixels, width, height),
        });
        for (const item of [reference, nextReference, view]) {
          item.tex.dispose();
          item.label.material.dispose();
        }
      }
    }
    document.querySelector("#gpu").remove();
    document.body.append(comparison);
    const result = {
      comparisons,
      noUploadChanges,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      checkShaderErrors: renderer.debug.checkShaderErrors,
    };
    renderer.dispose();
    return result;
  });

  writeFileSync(
    `/tmp/archer-validation/player-labels-${engine}.json`,
    JSON.stringify(result, null, 2),
  );
  await page.screenshot({
    path: `/tmp/archer-validation/player-labels-${engine}.png`,
    fullPage: true,
  });
  for (const sample of [...result.comparisons, ...result.noUploadChanges]) {
    const context = JSON.stringify(sample);
    assert.ok(sample.paintedPixels > 0, `visible name/bar ${context}`);
    assert.equal(
      sample.alphaMaxError,
      0,
      `alpha mask is preserved: ${context}`,
    );
    assert.ok(sample.nameMeanError <= 0.05, `name remains intact: ${context}`);
    // Mipmapped Canvas interpolation and the GPU fill boundary may differ at
    // the small moving edge. Record this separately from lost names/colours.
    assert.ok(sample.meanError <= 1, `small overall pixel error: ${context}`);
    assert.ok(
      sample.highDifferenceFraction <= 0.02,
      `differences remain local: ${context}`,
    );
  }
  assert.ok(
    result.noUploadChanges.every((sample) => sample.textureVersionUnchanged),
  );
  assert.ok(
    result.noUploadChanges.every((sample) => sample.textureUploads === 0),
  );
  assert.equal(result.glError, 0);
  assert.equal(result.contextLost, false);
  assert.equal(result.checkShaderErrors, true);
  assert.deepEqual(errors, []);
  console.log(`PLAYER_LABEL_BROWSER_OK ${engine}: ${JSON.stringify(result)}`);
} catch (error) {
  annotateFailure(error, "Player label GPU/reference regression");
  throw error;
} finally {
  await browser.close();
  await server.close();
}
