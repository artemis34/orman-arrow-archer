import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  AvatarBatches,
  ArrowBatches,
  ParticleBatch,
} from "../client/render-pools.js";

function actor(x, color, shadow = true) {
  const root = new THREE.Group(),
    hip = new THREE.Group();
  root.position.set(x, 0, 3);
  hip.position.y = 0.5;
  hip.rotation.z = 0.4;
  const part = new THREE.Mesh(
    new THREE.BoxGeometry(0.23, 0.48, 0.22),
    new THREE.MeshStandardMaterial({ color }),
  );
  part.position.y = -0.24;
  part.castShadow = shadow;
  hip.add(part);
  root.add(hip);
  return { root, hip, part };
}
function close(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) =>
    assert.ok(
      Math.abs(n - Math.fround(expected[i])) < 1e-6,
      `component ${i}: ${n} vs ${expected[i]}`,
    ),
  );
}

test("avatar instancing preserves animated world transforms, individual colors and shadow casters", () => {
  const scene = new THREE.Scene(),
    pool = new AvatarBatches(scene);
  const a = actor(-4, 0x35ab78),
    b = actor(90, 0xae769c);
  pool.add(a.root);
  pool.add(b.root);
  a.root.updateMatrixWorld(true);
  b.root.updateMatrixWorld(true);
  pool.update();
  assert.equal(pool.batches.size, 1);
  const { mesh } = [...pool.batches.values()][0];
  assert.equal(
    mesh.count,
    2,
    "off-camera archers must still cast their shadows",
  );
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.frustumCulled, false);
  assert.equal(
    a.part.layers.test(new THREE.Layers()),
    false,
    "source is not drawn twice",
  );
  const matrix = new THREE.Matrix4(),
    color = new THREE.Color();
  mesh.getMatrixAt(0, matrix);
  close(matrix.elements, a.part.matrixWorld.elements);
  mesh.getMatrixAt(1, matrix);
  close(matrix.elements, b.part.matrixWorld.elements);
  mesh.getColorAt(1, color);
  close(color.toArray(), b.part.material.color.toArray());
  const colorVersion = mesh.instanceColor.version;
  pool.update();
  assert.equal(
    mesh.instanceColor.version,
    colorVersion,
    "unchanged colors aren't uploaded again",
  );
  b.part.material.color.setHex(0x82dfff);
  b.hip.rotation.z = -0.6;
  b.root.updateMatrixWorld(true);
  pool.update();
  mesh.getMatrixAt(1, matrix);
  close(matrix.elements, b.part.matrixWorld.elements);
  mesh.getColorAt(1, color);
  close(color.toArray(), b.part.material.color.toArray());
});

test("death, departures and batch growth cannot leave ghosts or dispose another player's geometry", () => {
  const scene = new THREE.Scene(),
    pool = new AvatarBatches(scene, 1);
  const a = actor(0, 0xff0000),
    b = actor(3, 0x0000ff),
    c = actor(6, 0x00ff00);
  pool.add(a.root);
  let disposed = false;
  a.part.geometry.addEventListener("dispose", () => {
    disposed = true;
  });
  pool.add(b.root);
  pool.add(c.root);
  a.root.visible = false;
  for (const p of [a, b, c]) p.root.updateMatrixWorld(true);
  pool.update();
  const batch = [...pool.batches.values()][0];
  assert.ok(batch.mesh.instanceMatrix.count >= 3);
  assert.equal(batch.mesh.count, 2);
  assert.equal(disposed, false);
  pool.remove(a.root);
  pool.remove(b.root);
  pool.update();
  assert.equal(batch.mesh.count, 1);
  assert.equal(batch.parts[0].root, c.root);
  assert.equal(disposed, false);
  pool.remove(c.root);
  pool.update();
  assert.equal(batch.mesh.count, 0);
  assert.equal(
    batch.colors.length,
    0,
    "departing avatar references are released",
  );
});

test("different geometry, material sides and shadow settings stay in separate avatar batches", () => {
  const pool = new AvatarBatches(new THREE.Scene());
  const a = actor(0, 0xff0000),
    b = actor(2, 0x00ff00, false),
    c = actor(4, 0x0000ff);
  c.part.material.side = THREE.DoubleSide;
  for (const p of [a, b, c]) pool.add(p.root);
  assert.equal(pool.batches.size, 3);
  assert.equal(
    [...pool.batches.values()].filter((b) => b.mesh.castShadow).length,
    2,
  );
});

test("ground marker instances retain opacity, team tint and per-player visibility", () => {
  const pool = new AvatarBatches(new THREE.Scene()),
    root = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.76, 32),
    new THREE.MeshBasicMaterial({
      color: 0xff7777,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  ring.userData.instanceGround = true;
  root.add(ring);
  pool.add(root);
  root.updateMatrixWorld(true);
  pool.update();
  const batch = [...pool.batches.values()][0];
  assert.equal(batch.mesh.material.opacity, 0.8);
  assert.equal(batch.mesh.material.side, THREE.DoubleSide);
  ring.visible = false;
  pool.update();
  assert.equal(batch.mesh.count, 0);
  ring.visible = true;
  ring.material.color.setHex(0x82dfff);
  pool.update();
  const color = new THREE.Color();
  batch.mesh.getColorAt(0, color);
  close(color.toArray(), ring.material.color.toArray());
});

test("all 360 arrows keep full shaft/head geometry, pose and elemental emissive colors in five draws", () => {
  const pool = new ArrowBatches(new THREE.Scene(), 360);
  const arrows = Array.from({ length: 360 }, (_, id) => ({
    id,
    x: id / 10,
    z: -id / 20,
    angle: id / 9,
    effect: ["normal", "frost", "blast", "poison"][id % 4],
  }));
  pool.update(arrows);
  assert.equal(pool.shafts.count, 360);
  for (const mesh of pool.headMeshes) assert.equal(mesh.count, 90);
  assert.equal(pool.heads.frost.material.emissive.getHex(), 0x8cdfff);
  assert.equal(pool.heads.blast.material.emissiveIntensity, 0.15);
  const matrix = new THREE.Matrix4(),
    dummy = new THREE.Object3D();
  dummy.position.set(arrows[359].x, 1, arrows[359].z);
  dummy.rotation.y = -arrows[359].angle;
  dummy.updateMatrix();
  pool.shafts.getMatrixAt(359, matrix);
  close(matrix.elements, dummy.matrix.elements);
  assert.equal(pool.shafts.geometry.parameters.radialSegments, 5);
  assert.equal(pool.heads.normal.geometry.parameters.radialSegments, 3);
  pool.update([]);
  assert.equal(pool.shafts.count, 0);
  assert.ok(pool.headMeshes.every((mesh) => mesh.count === 0));
});

test("particle pooling retains all 140 particles, their individual fading and transparent depth order", () => {
  const geometry = new THREE.OctahedronGeometry(0.11);
  const effects = Array.from({ length: 140 }, (_, i) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xffaa66 : 0xaadd88,
        transparent: true,
        opacity: i / 140,
      }),
    );
    mesh.position.set(0, 1, -i);
    mesh.rotation.x = i / 10;
    mesh.scale.setScalar(0.45 + i / 140);
    return { life: 1, mesh };
  });
  const pool = new ParticleBatch(new THREE.Scene(), effects, geometry),
    camera = new THREE.PerspectiveCamera();
  camera.updateMatrixWorld();
  pool.update(camera);
  assert.equal(pool.mesh.count, 140);
  assert.equal(pool.active[0], effects[139]);
  assert.ok(Math.abs(pool.opacity.getX(0) - 139 / 140) < 1e-6);
  const matrix = new THREE.Matrix4();
  pool.mesh.getMatrixAt(0, matrix);
  close(matrix.elements, effects[139].mesh.matrix.elements);
  effects.forEach((e) => (e.life = 0));
  pool.update(camera);
  assert.equal(pool.mesh.count, 0);
});
