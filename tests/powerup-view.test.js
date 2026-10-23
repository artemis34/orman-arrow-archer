import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { PowerupView } from "../client/powerup-view.js";

const sites = () => [
  { key: "haste", x: -17, z: -12, cooldown: 0 },
  { key: "power", x: 17, z: 12, cooldown: 0 },
];
test("powerup badges remain readable over foliage while world effects retain their depth", () => {
  const scene = new THREE.Scene(),
    view = new PowerupView(scene);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
  camera.position.set(5, 32, 25);
  camera.lookAt(5, 0, 0);
  view.update(sites(), 1, camera);
  assert.equal(view.root.visible, true);
  assert.equal(view.pads.count, 2);
  assert.equal(view.gems.count, 2);
  assert.equal(view.badges[0].haste.visible, true);
  assert.equal(view.badges[0].power.visible, false);
  assert.equal(view.badges[1].power.visible, true);
  assert.equal(view.badgeMaterial.depthTest, false);
  assert.equal(view.badgeMaterial.depthWrite, false);
  for (const mesh of view.batches) assert.equal(mesh.material.depthTest, true);
  assert.ok(view.badges[0].haste.quaternion.equals(camera.quaternion));
  assert.ok(view.badges[0].haste.position.y > 2.5);
  const readyMeshes = view.root.children.filter(
    (mesh) => mesh.visible && (!mesh.isInstancedMesh || mesh.count),
  );
  assert.equal(
    readyMeshes.length,
    6,
    "two richer objectives keep the previous six-draw maximum",
  );
});
test("powerup cooldown, missing/unknown sites and return to lobby cannot leave ghost markers", () => {
  const view = new PowerupView(new THREE.Scene()),
    state = sites();
  state[0].cooldown = 30;
  view.update(state, 3);
  assert.equal(view.pads.count, 2);
  assert.equal(view.gems.count, 1);
  assert.equal(view.badges[0].haste.visible, false);
  assert.equal(view.badges[1].power.visible, true);
  view.update([{ key: "unknown", x: 0, z: 0, cooldown: 0 }], 4);
  assert.equal(view.root.visible, false);
  assert.equal(view.gems.count, 0);
  view.update(sites(), 5);
  view.update(undefined, 6);
  assert.equal(view.root.visible, false);
  for (const row of view.badges)
    for (const badge of Object.values(row)) assert.equal(badge.visible, false);
});
test("ready and cooling objectives reuse all buffers, geometries and materials", () => {
  const view = new PowerupView(new THREE.Scene()),
    state = sites();
  const buffers = view.batches.map((mesh) => [
    mesh.instanceMatrix.array,
    mesh.instanceColor.array,
    mesh.geometry,
    mesh.material,
  ]);
  const badges = Object.values(view.badgeGeometries);
  for (let frame = 0; frame < 500; frame++) {
    state[frame % 2].cooldown = frame % 4 ? 0 : 45;
    view.update(state, frame / 60);
    view.root.updateMatrixWorld();
  }
  for (let i = 0; i < view.batches.length; i++) {
    const mesh = view.batches[i],
      saved = buffers[i];
    assert.equal(mesh.instanceMatrix.array, saved[0]);
    assert.equal(mesh.instanceColor.array, saved[1]);
    assert.equal(mesh.geometry, saved[2]);
    assert.equal(mesh.material, saved[3]);
  }
  assert.deepEqual(Object.values(view.badgeGeometries), badges);
});
