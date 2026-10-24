import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPlayerLabel } from "../client/player-label.js";
import { TEAMS } from "../shared/modes.js";

function fixture(player = {}, local = false) {
  const calls = [];
  const ctx = {
    clearRect(...args) {
      calls.push(["clear", ...args]);
    },
    fillRect(...args) {
      calls.push(["rect", this.fillStyle, ...args]);
    },
    fillText(...args) {
      calls.push(["text", this.fillStyle, this.font, this.shadowBlur, ...args]);
    },
  };
  const canvas = { getContext: () => ctx };
  const p = { name: "Robin", hp: 150, maxHp: 150, ...player };
  const view = createPlayerLabel(p, local, () => canvas);
  const shader = {
    uniforms: {},
    fragmentShader: THREE.ShaderLib.sprite.fragmentShader,
  };
  view.label.material.onBeforeCompile(shader);
  return { p, view, shader, calls };
}

function rawColour(uniform, hex) {
  const expected = new THREE.Color(hex).convertLinearToSRGB();
  for (const channel of ["r", "g", "b"])
    assert.ok(Math.abs(uniform.value[channel] - expected[channel]) < 1e-12);
}

test("player labels keep their canvas, sprite, name typography and shader colour space", () => {
  const { view, shader, calls } = fixture();
  assert.equal(view.canvas.width, 256);
  assert.equal(view.canvas.height, 80);
  assert.equal(view.tex.colorSpace, THREE.NoColorSpace);
  assert.equal(view.tex.flipY, true);
  assert.equal(view.tex.minFilter, THREE.LinearMipmapLinearFilter);
  assert.deepEqual(view.label.scale.toArray(), [3.8, 1.2, 1]);
  assert.equal(view.label.position.y, 2.6);
  assert.equal(view.label.material.depthTest, false);
  assert.equal(view.label.material.transparent, true);
  assert.deepEqual(calls, [
    ["clear", 0, 0, 256, 38],
    ["text", "#eef3dc", "600 22px sans-serif", 7, "Robin", 128, 27],
    ["rect", "#ffffff", 64, 44, 128, 8],
  ]);
  assert.equal(shader.uniforms.wbLabelHealth.value, 1);
  rawColour(shader.uniforms.wbLabelBackground, "#192e22");
  rawColour(shader.uniforms.wbLabelHealthColour, "#bde08d");
  assert.match(shader.fragmentShader, /#include <map_fragment>/);
  assert.match(shader.fragmentShader, /float wbLabelPixelCoverage/);
  assert.match(shader.fragmentShader, /filled \/ full/);
  assert.equal(
    view.label.material.customProgramCacheKey(),
    "wildbow-player-label-health-v1",
  );
});

test("combat HP, maximum HP and critical colour update uniforms without uploading or repainting", () => {
  const { p, view, shader, calls } = fixture();
  const version = view.tex.version;
  const materialVersion = view.label.material.version;
  const uniforms = { ...shader.uniforms };
  calls.length = 0;
  for (let hp = 150; hp >= 0; hp--) view.update({ ...p, hp });
  assert.deepEqual(calls, []);
  assert.equal(view.tex.version, version);
  assert.equal(view.label.material.version, materialVersion);
  assert.deepEqual(shader.uniforms, uniforms, "uniform objects are reused");
  assert.equal(shader.uniforms.wbLabelHealth.value, 0);
  rawColour(shader.uniforms.wbLabelHealthColour, "#e6a181");
  view.update({ ...p, hp: 75, maxHp: 300 });
  assert.equal(shader.uniforms.wbLabelHealth.value, 0.25);
  rawColour(shader.uniforms.wbLabelHealthColour, "#e6a181");
  view.update({ ...p, hp: 90, maxHp: 300 });
  assert.equal(shader.uniforms.wbLabelHealth.value, 0.3);
  rawColour(shader.uniforms.wbLabelHealthColour, "#bde08d");
});

test("team and name changes redraw the name once; HP changes retain team tint and low-HP override", () => {
  const { p, view, shader, calls } = fixture({ team: 0 });
  rawColour(shader.uniforms.wbLabelHealthColour, TEAMS[0].color);
  const version = view.tex.version;
  calls.length = 0;
  assert.equal(view.update({ ...p, team: 1, name: "Ash" }), true);
  assert.equal(view.tex.version, version + 1);
  assert.deepEqual(calls, [
    ["clear", 0, 0, 256, 38],
    [
      "text",
      TEAMS[1].color,
      "600 22px sans-serif",
      0,
      `${TEAMS[1].symbol} Ash`,
      128,
      27,
    ],
  ]);
  rawColour(shader.uniforms.wbLabelHealthColour, TEAMS[1].color);
  calls.length = 0;
  assert.equal(view.update({ ...p, team: 1, name: "Ash", hp: 20 }), false);
  assert.deepEqual(calls, []);
  assert.equal(view.tex.version, version + 1);
  rawColour(shader.uniforms.wbLabelHealthColour, "#e6a181");
  view.update({ ...p, team: null });
  rawColour(shader.uniforms.wbLabelHealthColour, "#bde08d");
  assert.equal(calls.at(-1)[4], "Robin");
});

test("local labels omit the solo name and display Sen in a team", () => {
  const { p, view, calls } = fixture({}, true);
  assert.equal(view.label.position.y, 2.35);
  assert.equal(calls.filter(([kind]) => kind === "text").length, 0);
  calls.length = 0;
  view.update({ ...p, team: 2 });
  assert.deepEqual(calls.at(-1), [
    "text",
    TEAMS[2].color,
    "600 22px sans-serif",
    0,
    `${TEAMS[2].symbol} Sen`,
    128,
    27,
  ]);
  calls.length = 0;
  view.update({ ...p, team: null });
  assert.deepEqual(calls, [["clear", 0, 0, 256, 38]]);
});

test("white-mask edge normalisation preserves empty, full and fractional Canvas base-level fills", () => {
  const coverage = (pixel, edge) =>
    Math.max(0, Math.min(1, Math.min(edge, pixel + 1) - Math.max(64, pixel)));
  const mix = (a, b, t) => a + (b - a) * t;
  for (const hp of [0, 0.01, 0.15, 0.5, 0.995, 1]) {
    const edge = 64 + hp * 128;
    for (let x = 62.125; x < 194; x += 0.125) {
      const pixel = Math.floor(x - 0.5),
        blend = x - 0.5 - pixel,
        full = mix(coverage(pixel, 192), coverage(pixel + 1, 192), blend),
        fill = mix(coverage(pixel, edge), coverage(pixel + 1, edge), blend),
        fraction = full > 0 ? fill / full : 0;
      assert.ok(fraction >= 0 && fraction <= 1);
      for (const [background, health] of [
        [0.1, 0.9],
        [0.6, 0.3],
      ]) {
        const shader = full * mix(background, health, fraction);
        const canvas = mix(
          coverage(pixel, 192) * background +
            coverage(pixel, edge) * (health - background),
          coverage(pixel + 1, 192) * background +
            coverage(pixel + 1, edge) * (health - background),
          blend,
        );
        assert.ok(Math.abs(shader - canvas) < 1e-12);
      }
    }
  }
});

test("missing/invalid health cannot generate NaN shader uniforms or upload name textures", () => {
  const { p, view, shader } = fixture();
  const version = view.tex.version;
  for (const hp of [-5, Infinity, NaN]) {
    view.update({ ...p, hp, maxHp: 0 });
    assert.equal(shader.uniforms.wbLabelHealth.value, 0);
  }
  view.update({ ...p, hp: 999 });
  assert.equal(shader.uniforms.wbLabelHealth.value, 1);
  assert.equal(view.tex.version, version);
});
