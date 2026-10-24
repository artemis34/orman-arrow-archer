import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { AvatarLines } from "../client/avatar-lines.js";

function line(points, color = new THREE.Color(1, 1, 1), options = {}) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      points.map((point) => new THREE.Vector3(...point)),
    ),
    new THREE.LineBasicMaterial({ color, ...options }),
  );
}

function vertex(attribute, index) {
  return [attribute.getX(index), attribute.getY(index), attribute.getZ(index)];
}

function near(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++)
    assert.ok(
      Math.abs(actual[i] - expected[i]) < 1e-5,
      `${actual} != ${expected}`,
    );
}

test("line strips retain all endpoints, full nested transforms and linear RGB colours", () => {
  const scene = new THREE.Scene();
  const lines = new AvatarLines(scene, 4);
  const root = new THREE.Group();
  root.position.set(10, 0, -5);
  root.rotation.y = Math.PI / 2;
  root.scale.set(2, 3, 4);
  const bow = new THREE.Group();
  bow.position.set(1, 2, 3);
  const bowLine = line(
    [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    new THREE.Color().setRGB(0.25, 0.5, 0.75),
  );
  bowLine.position.z = 1;
  bow.add(bowLine);
  const string = line(
    [
      [0, 0, 0],
      [0, 2, 0],
    ],
    new THREE.Color().setRGB(0.75, 0.25, 0.5),
  );
  string.position.x = -1;
  root.add(bow, string);
  scene.add(root);
  lines.add(root);
  scene.updateMatrixWorld(true);
  lines.update();
  const expected = [
    [26, 9, -7],
    [26, 9, -9],
    [26, 9, -9],
    [30, 9, -9],
    [10, 0, -3],
    [10, 6, -3],
  ];
  assert.equal(lines.mesh.geometry.drawRange.count, expected.length);
  for (let i = 0; i < expected.length; i++) {
    near(vertex(lines.positions, i), expected[i]);
    near(
      vertex(lines.colors, i),
      i < 4 ? [0.25, 0.5, 0.75] : [0.75, 0.25, 0.5],
    );
  }
  assert.equal(lines.material.vertexColors, true);
  near(lines.material.color.toArray(), [1, 1, 1]);
  assert.equal(lines.material.depthTest, bowLine.material.depthTest);
  assert.equal(lines.material.depthWrite, bowLine.material.depthWrite);
  assert.equal(lines.material.fog, bowLine.material.fog);
  assert.equal(lines.material.toneMapped, bowLine.material.toneMapped);
  assert.equal(bowLine.layers.isEnabled(0), false);
  assert.equal(string.layers.isEnabled(0), false);
  assert.equal(
    bowLine.userData.batched,
    undefined,
    "source geometry retains its original owner",
  );
});

test("source/ancestor visibility and layer membership retain Three's semantics", () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const root = new THREE.Group();
  const source = line([
    [0, 0, 0],
    [1, 0, 0],
  ]);
  source.layers.enable(1);
  root.add(source);
  group.add(root);
  scene.add(group);
  const excluded = line([
    [0, 0, 0],
    [0, 1, 0],
  ]);
  excluded.layers.set(1);
  root.add(excluded);
  const lines = new AvatarLines(scene);
  lines.add(root);
  scene.updateMatrixWorld(true);
  lines.update();
  assert.equal(lines.mesh.geometry.drawRange.count, 2);
  assert.equal(
    source.layers.mask,
    2,
    "other camera layers keep the original line",
  );
  assert.equal(excluded.layers.mask, 2);

  group.visible = false;
  lines.update();
  assert.equal(lines.mesh.visible, false);
  group.visible = true;
  group.layers.disable(0);
  lines.update();
  assert.equal(
    lines.mesh.visible,
    true,
    "ancestor layers do not hide descendants in Three",
  );
  root.visible = false;
  lines.update();
  assert.equal(lines.mesh.geometry.drawRange.count, 0);
  root.visible = true;
  source.visible = false;
  lines.update();
  assert.equal(lines.mesh.visible, false);
  source.visible = true;
  lines.update();
  assert.equal(lines.mesh.geometry.drawRange.count, 2);
  lines.remove(root);
  assert.equal(
    source.layers.mask,
    3,
    "remove restores only the owned camera layer",
  );
  assert.equal(excluded.layers.mask, 2);
  assert.equal(lines.roots.size, 0);
  assert.equal(lines.active.length, 0);
  assert.equal(lines.mesh.visible, false);
});

test("unsupported lines keep their own draw and dynamic material changes safely fall back", () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const compatible = line([
    [0, 0, 0],
    [1, 0, 0],
  ]);
  const transparent = line(
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    undefined,
    { transparent: true },
  );
  const thick = line(
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    undefined,
    { linewidth: 2 },
  );
  const overlay = line(
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    undefined,
    { depthTest: false },
  );
  const noFog = line(
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    undefined,
    { fog: false },
  );
  root.add(compatible, transparent, thick, overlay, noFog);
  scene.add(root);
  const lines = new AvatarLines(scene);
  lines.add(root);
  scene.updateMatrixWorld(true);
  lines.update();
  assert.equal(lines.mesh.geometry.drawRange.count, 2);
  for (const source of [transparent, thick, overlay, noFog])
    assert.equal(source.layers.isEnabled(0), true);
  compatible.material.transparent = true;
  lines.update();
  assert.equal(lines.mesh.visible, false);
  assert.equal(compatible.layers.isEnabled(0), true);
  compatible.material.transparent = false;
  lines.update();
  assert.equal(lines.mesh.geometry.drawRange.count, 2);
  assert.equal(compatible.layers.isEnabled(0), false);
});

test("indexed draw ranges preserve line-strip segments and traversal order", () => {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const source = line([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
  ]);
  source.geometry.setIndex([3, 1, 2, 0]);
  source.geometry.setDrawRange(1, 3);
  root.add(source);
  scene.add(root);
  const lines = new AvatarLines(scene);
  lines.add(root);
  scene.updateMatrixWorld(true);
  lines.update();
  assert.equal(lines.mesh.geometry.drawRange.count, 4);
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => lines.positions.getX(i)),
    [1, 2, 2, 0],
  );
});

function archer(x = 0) {
  const root = new THREE.Group();
  root.position.x = x;
  const bow = new THREE.Group();
  bow.position.x = 0.45;
  const curve = Array.from({ length: 19 }, (_, i) => [
    Math.cos((i / 18) * Math.PI) * 0.48,
    1,
    Math.sin((i / 18) * Math.PI) * 0.72,
  ]);
  const bowLine = line(curve);
  const string = line([
    [0, 1, -0.72],
    [-0.05, 1, 0],
    [0, 1, 0.72],
  ]);
  bow.add(bowLine, string);
  root.add(bow);
  return { root, bowLine, string };
}

test("sixteen full bows/strings fit one bounded draw with live charge and buff colours", () => {
  const scene = new THREE.Scene();
  const lines = new AvatarLines(scene);
  const archers = Array.from({ length: 16 }, (_, i) => archer(i - 8));
  for (const { root } of archers) {
    scene.add(root);
    lines.add(root);
  }
  scene.updateMatrixWorld(true);
  lines.update();
  assert.equal(lines.mesh.isLineSegments, true);
  assert.equal(lines.mesh.geometry.drawRange.count, 640);
  const geometry = lines.mesh.geometry;
  const positions = lines.positions;
  const colors = lines.colors;
  for (let i = 0; i < 60; i++) {
    archers[0].string.geometry.attributes.position.setXYZ(1, -0.45, 1, 0);
    archers[0].bowLine.material.color.setRGB(0.125, 0.5, 0.75);
    lines.update();
  }
  assert.equal(lines.mesh.geometry, geometry);
  assert.equal(lines.positions, positions);
  assert.equal(lines.colors, colors);
  near(vertex(lines.positions, 37), [-8, 1, 0]);
  near(vertex(lines.positions, 38), [-8, 1, 0]);
  near(vertex(lines.colors, 0), [0.125, 0.5, 0.75]);
  const colorVersion = colors.version;
  lines.update();
  assert.equal(
    colors.version,
    colorVersion,
    "unchanged colours are not uploaded every frame",
  );
  assert.equal(lines.positions.updateRanges.length, 1);
  assert.equal(lines.positions.updateRanges[0].count, 640 * 3);
  assert.equal(lines.colors.updateRanges[0].count, 640 * 3);
  assert.ok(lines.capacity < 640 * 2);
});

test("pool growth disposes old batch buffers but never the source geometry/material", () => {
  const scene = new THREE.Scene();
  const lines = new AvatarLines(scene, 2);
  const old = lines.mesh.geometry;
  let batchDisposals = 0;
  let sourceDisposals = 0;
  old.addEventListener("dispose", () => batchDisposals++);
  const actor = archer();
  actor.bowLine.geometry.addEventListener("dispose", () => sourceDisposals++);
  actor.bowLine.material.addEventListener("dispose", () => sourceDisposals++);
  scene.add(actor.root);
  lines.add(actor.root);
  scene.updateMatrixWorld(true);
  lines.update();
  assert.equal(batchDisposals, 1);
  assert.equal(lines.capacity, 64);
  assert.equal(lines.mesh.geometry.drawRange.count, 40);
  assert.equal(sourceDisposals, 0);
  const grown = lines.mesh.geometry;
  for (let i = 0; i < 40; i++) lines.update();
  assert.equal(lines.mesh.geometry, grown);
  const version = lines.positions.version;
  lines.remove(actor.root);
  lines.update();
  assert.equal(lines.mesh.geometry.drawRange.count, 0);
  assert.equal(
    lines.positions.version,
    version,
    "empty pools do not dirty their buffers",
  );
  assert.equal(sourceDisposals, 0);
  lines.dispose();
  assert.equal(scene.children.includes(lines.mesh), false);
  actor.bowLine.geometry.dispose();
  actor.bowLine.material.dispose();
  assert.equal(
    sourceDisposals,
    2,
    "normal avatar teardown retains disposal ownership",
  );
});
