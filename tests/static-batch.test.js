import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ArenaScene } from "../client/scene.js";
import { forestMaterials } from "../client/forest.js";
import { World } from "../shared/world.js";

const key = (mesh) => `${mesh.material.uuid}:${mesh.castShadow}`;
const bytes = (geometry) =>
  Object.values(geometry.attributes).reduce(
    (total, attribute) => total + attribute.array.byteLength,
    geometry.index?.array.byteLength || 0,
  );

// The shipped reference expanded every indexed face before applying its world
// transform. Compare actual corner attributes, not just vertex/triangle counts.
function legacyBatches(group) {
  group.updateMatrixWorld(true);
  const batches = new Map();
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    geometry.deleteAttribute("uv");
    geometry.applyMatrix4(mesh.matrixWorld);
    if (!batches.has(key(mesh))) batches.set(key(mesh), []);
    batches.get(key(mesh)).push(geometry);
  });
  for (const [id, geometries] of batches) {
    batches.set(id, mergeGeometries(geometries));
    for (const geometry of geometries) geometry.dispose();
  }
  return batches;
}

function compareBatches(group, reference) {
  const current = new Map(group.children.map((mesh) => [key(mesh), mesh]));
  assert.equal(current.size, reference.size, "draw batches are unchanged");
  let beforeBytes = 0,
    afterBytes = 0,
    beforeVertices = 0,
    afterVertices = 0,
    triangles = 0;
  for (const [id, expected] of reference) {
    const mesh = current.get(id);
    assert.ok(mesh);
    assert.equal(mesh.receiveShadow, true);
    const actual = mesh.geometry;
    const expanded = actual.index ? actual.toNonIndexed() : actual.clone();
    assert.deepEqual(
      Object.keys(expanded.attributes).sort(),
      Object.keys(expected.attributes).sort(),
    );
    for (const name in expected.attributes) {
      const next = expanded.attributes[name];
      const prior = expected.attributes[name];
      assert.equal(next.itemSize, prior.itemSize);
      assert.equal(next.normalized, prior.normalized);
      assert.deepEqual(
        next.array,
        prior.array,
        `${name}: exact transformed face corners and order`,
      );
    }
    const count = actual.index?.count ?? actual.attributes.position.count;
    assert.equal(count, expected.attributes.position.count);
    assert.equal(actual.attributes.uv, undefined);
    beforeBytes += bytes(expected);
    afterBytes += bytes(actual);
    beforeVertices += expected.attributes.position.count;
    afterVertices += actual.attributes.position.count;
    triangles += count / 3;
    expanded.dispose();
  }
  return { beforeBytes, afterBytes, beforeVertices, afterVertices, triangles };
}

test("indexed and non-indexed props keep exact transformed triangles, hard edges and colors", () => {
  const group = new THREE.Group();
  group.position.set(7.5, -0.3, 12);
  group.rotation.set(0.1, 0.8, -0.2);
  const solid = new THREE.MeshStandardMaterial(),
    other = new THREE.MeshStandardMaterial();
  const shapes = [
    new THREE.BoxGeometry(1, 2, 3),
    new THREE.BoxGeometry(0.5, 2.5, 1).toNonIndexed(),
    new THREE.CylinderGeometry(0.7, 1, 2, 7),
    new THREE.IcosahedronGeometry(1, 0),
  ];
  for (let i = 0; i < shapes.length; i++) {
    const geometry = shapes[i];
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let n = 0; n < colors.length; n++) colors[n] = (n % 7) / 7;
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, i === 3 ? other : solid);
    mesh.position.set(i * 2.1, i * 0.7, -i * 1.3);
    mesh.rotation.set(i * 0.2, -i * 0.5, i * 0.13);
    mesh.scale.set(1 + i * 0.2, 0.6 + i * 0.1, 1.2);
    mesh.castShadow = i !== 3;
    group.add(mesh);
  }
  const reference = legacyBatches(group);
  ArenaScene.prototype.batch.call({}, group);
  compareBatches(group, reference);
  assert.ok(group.children.every((mesh) => !mesh.matrixAutoUpdate));
  assert.ok(
    group.children.find((mesh) => mesh.material === solid).geometry.index,
  );
  assert.equal(
    group.children.find((mesh) => mesh.material === other).geometry.index,
    null,
    "a wholly non-indexed material batch needs no extra index storage",
  );
});

test("210 ground patches retain all 1470 faces while reducing vertex storage", () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ depthWrite: false });
  for (let i = 0; i < 210; i++) {
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(1 + i / 210, 7),
      material,
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set((i % 15) * 2, 0.015, Math.floor(i / 15) * 2);
    group.add(patch);
  }
  const reference = legacyBatches(group);
  ArenaScene.prototype.batch.call({}, group);
  const result = compareBatches(group, reference);
  assert.equal(result.triangles, 1470);
  assert.equal(result.beforeVertices, 4410);
  assert.equal(result.afterVertices, 1890);
  assert.ok(result.afterBytes < result.beforeBytes * 0.52);
  console.log("STATIC_PATCH_STORAGE", JSON.stringify(result));
});

test("the complete forest map retains exact face attributes and shadow/material batches", () => {
  const world = new World({ bots: 0 });
  let reference;
  const view = {
    worldGroup: new THREE.Group(),
    forestMats: forestMaterials(),
    batch(group) {
      reference = legacyBatches(group);
      ArenaScene.prototype.batch.call(this, group);
    },
  };
  ArenaScene.prototype.setMap.call(view, world.obstacles);
  const result = compareBatches(view.worldGroup, reference);
  assert.ok(result.afterBytes < result.beforeBytes);
  assert.ok(result.afterVertices < result.beforeVertices);
  console.log("STATIC_FOREST_STORAGE", JSON.stringify(result));
});

test("sequential indices cross the reserved 16-bit boundary without wrapping", () => {
  const count = 65538;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  group.add(new THREE.Mesh(geometry, material));
  const box = new THREE.BoxGeometry();
  group.add(new THREE.Mesh(box, material));
  ArenaScene.prototype.batch.call({}, group);
  const index = group.children[0].geometry.index;
  assert.ok(index.array instanceof Uint32Array);
  assert.equal(index.count, count + box.index.count);
  for (const i of [0, 1, 65534, 65535, 65536, 65537])
    assert.equal(index.getX(i), i);
});

test("shared source geometries are disposed once after their indexed copies are merged", () => {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  let disposed = 0;
  geometry.addEventListener("dispose", () => disposed++);
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = i * 2;
    group.add(mesh);
  }
  const reference = legacyBatches(group);
  ArenaScene.prototype.batch.call({}, group);
  compareBatches(group, reference);
  assert.equal(disposed, 1);
});
