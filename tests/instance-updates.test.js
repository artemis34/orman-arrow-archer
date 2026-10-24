import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WebGLAttributes } from "three/src/renderers/webgl/WebGLAttributes.js";
import { publishInstanceRange } from "../client/instance-updates.js";
import {
  AvatarBatches,
  ArrowBatches,
  ParticleBatch,
} from "../client/render-pools.js";
import { BowBuffEffects } from "../client/bow-buff-effects.js";

// Exercise Three's actual upload and range-consumption code without starting a
// second browser/GPU. The mock stores the bytes WebGL would have received.
function uploads() {
  let bound;
  const calls = [];
  const gl = {
    FLOAT: 0x1406,
    ARRAY_BUFFER: 0x8892,
    createBuffer: () => ({}),
    bindBuffer: (_type, buffer) => {
      bound = buffer;
    },
    bufferData(_type, array) {
      bound.bytes = new Uint8Array(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      ).slice();
      calls.push({ allocate: true, bytes: array.byteLength });
    },
    bufferSubData(_type, offset, array, start = 0, count = array.length) {
      const bytes = new Uint8Array(
        array.buffer,
        array.byteOffset + start * array.BYTES_PER_ELEMENT,
        count * array.BYTES_PER_ELEMENT,
      );
      bound.bytes.set(bytes, offset);
      calls.push({ allocate: false, offset, bytes: bytes.byteLength });
    },
  };
  const attributes = WebGLAttributes(gl);
  return {
    calls,
    update: (attribute) => attributes.update(attribute, gl.ARRAY_BUFFER),
    gpu(attribute) {
      const bytes = attributes.get(attribute).buffer.bytes;
      return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    },
  };
}

function assertActive(gpu, attribute, count) {
  assert.deepEqual(
    gpu.gpu(attribute).slice(0, count * attribute.itemSize),
    attribute.array.slice(0, count * attribute.itemSize),
  );
}

test("Three initially allocates the full pool, then uploads only the active prefix", () => {
  const gpu = uploads();
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(32), 4);
  attribute.array.fill(1);
  publishInstanceRange(attribute, 3);
  gpu.update(attribute);
  assert.deepEqual(gpu.calls, [{ allocate: true, bytes: 128 }]);
  assertActive(gpu, attribute, 8);

  // The first allocation does not clear Three's pending ranges. After the
  // first sub-update, subsequent uploads track the current active count.
  attribute.array.fill(2, 0, 12);
  publishInstanceRange(attribute, 3);
  gpu.update(attribute);
  assert.equal(attribute.updateRanges.length, 0);
  assert.equal(gpu.calls.at(-1).bytes, 48);
  attribute.array.fill(3, 0, 8);
  publishInstanceRange(attribute, 2);
  gpu.update(attribute);
  assert.equal(gpu.calls.at(-1).bytes, 32);
  assertActive(gpu, attribute, 2);
  assert.equal(gpu.gpu(attribute)[8], 2, "unused slots are not uploaded");

  attribute.array.fill(4, 0, 24);
  publishInstanceRange(attribute, 6);
  gpu.update(attribute);
  assert.equal(gpu.calls.at(-1).bytes, 96);
  assertActive(gpu, attribute, 6);
});

test("hidden grow/shrink and zero-count updates preserve all pending writes", () => {
  const gpu = uploads();
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(24), 3);
  gpu.update(attribute);
  attribute.array.fill(1, 0, 18);
  publishInstanceRange(attribute, 6);
  attribute.array.fill(2, 0, 6);
  publishInstanceRange(attribute, 2);
  assert.equal(attribute.updateRanges[0].count, 18);
  const version = attribute.version;
  publishInstanceRange(attribute, 0);
  assert.equal(attribute.version, version);
  assert.equal(attribute.updateRanges[0].count, 18);
  gpu.update(attribute);
  assertActive(gpu, attribute, 6);
  assert.equal(gpu.calls.at(-1).bytes, 72);
  const calls = gpu.calls.length;
  publishInstanceRange(attribute, 0);
  gpu.update(attribute);
  assert.equal(gpu.calls.length, calls, "an empty clean pool stays clean");
});

test("active uploads retain any already-pending non-prefix range", () => {
  const gpu = uploads();
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(24), 3);
  gpu.update(attribute);
  attribute.array.fill(7, 18, 21);
  attribute.addUpdateRange(18, 3);
  attribute.needsUpdate = true;
  attribute.array.fill(2, 0, 3);
  publishInstanceRange(attribute, 1);
  gpu.update(attribute);
  assertActive(gpu, attribute, 7);
});

function avatar(x, color) {
  const root = new THREE.Group();
  const part = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color }),
  );
  part.castShadow = true;
  part.position.x = x;
  root.add(part);
  root.updateMatrixWorld(true);
  return { root, part };
}

test("empty avatar ring pools expose their final colour attribute before first buff or resize", () => {
  const scene = new THREE.Scene();
  const batches = new AvatarBatches(scene, 1);
  const makeRing = () => {
    const root = new THREE.Group();
    const part = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 0.9, 8),
      new THREE.MeshBasicMaterial({ color: 0x55bbff, transparent: true }),
    );
    part.visible = false;
    part.userData.instanceGround = true;
    root.add(part);
    root.updateMatrixWorld(true);
    return { root, part };
  };
  const first = makeRing();
  batches.add(first.root);
  batches.update();
  const original = [...batches.batches.values()][0].mesh;
  assert.equal(original.count, 0);
  assert.equal(original.instanceColor.count, 1);
  assert.equal(original.instanceColor.usage, THREE.DynamicDrawUsage);
  assert.deepEqual([...original.instanceColor.array], [1, 1, 1]);
  const gpu = uploads();
  gpu.update(original.instanceColor);

  // The first visible buff keeps the same attribute and shader feature bit.
  const colors = original.instanceColor;
  first.part.visible = true;
  batches.update();
  assert.equal(original.instanceColor, colors);
  assert.equal(original.count, 1);
  gpu.update(colors);
  assertActive(gpu, colors, 1);
  nearColor(colors.array, first.part.material.color);

  first.part.visible = false;
  const second = makeRing();
  batches.add(second.root);
  const grown = [...batches.batches.values()][0].mesh;
  assert.notEqual(grown, original);
  assert.equal(grown.instanceColor.count, 2);
  assert.equal(grown.instanceColor.usage, THREE.DynamicDrawUsage);
  assert.deepEqual([...grown.instanceColor.array], [1, 1, 1, 1, 1, 1]);
  batches.update();
  assert.equal(grown.count, 0);
  const grownColors = grown.instanceColor;
  second.part.visible = true;
  batches.update();
  assert.equal(grown.instanceColor, grownColors);
  assert.equal(grown.count, 1);
  gpu.update(grownColors);
  assertActive(gpu, grownColors, 1);
  nearColor(grownColors.array, second.part.material.color);
});

function nearColor(array, color) {
  assert.deepEqual(
    [...array.slice(0, 3)],
    [color.r, color.g, color.b].map(Math.fround),
  );
}

test("avatar pool resize and hidden colour changes cannot resurrect stale GPU colours", () => {
  const scene = new THREE.Scene();
  const batches = new AvatarBatches(scene, 2);
  const players = [avatar(1, 0xff0000), avatar(2, 0x00ff00)];
  for (const player of players) batches.add(player.root);
  batches.update();
  const original = [...batches.batches.values()][0].mesh;
  const gpu = uploads();
  gpu.update(original.instanceMatrix);
  gpu.update(original.instanceColor);

  players.push(avatar(3, 0x0000ff));
  batches.add(players[2].root);
  batches.update();
  const mesh = [...batches.batches.values()][0].mesh;
  assert.notEqual(mesh, original);
  assert.equal(mesh.instanceMatrix.count, 4);
  assert.equal(mesh.count, 3);
  gpu.update(mesh.instanceMatrix);
  gpu.update(mesh.instanceColor);
  assertActive(gpu, mesh.instanceMatrix, 3);
  assertActive(gpu, mesh.instanceColor, 3);

  // Simulate multiple game updates while the pool is not drawn. A smaller
  // subsequent update must not discard colour writes for hidden players.
  for (const player of players) player.part.material.color.setHex(0xffcc88);
  batches.update();
  players[1].root.visible = players[2].root.visible = false;
  players[0].part.material.color.setHex(0x8844ff);
  batches.update();
  assert.equal(mesh.count, 1);
  gpu.update(mesh.instanceMatrix);
  gpu.update(mesh.instanceColor);
  players[1].root.visible = players[2].root.visible = true;
  const colorVersion = mesh.instanceColor.version;
  batches.update();
  assert.equal(
    mesh.instanceColor.version,
    colorVersion,
    "cached colours stay unchanged",
  );
  gpu.update(mesh.instanceMatrix);
  gpu.update(mesh.instanceColor);
  assert.equal(mesh.count, 3);
  assertActive(gpu, mesh.instanceMatrix, 3);
  assertActive(gpu, mesh.instanceColor, 3);

  batches.remove(players[1].root);
  batches.update();
  gpu.update(mesh.instanceMatrix);
  gpu.update(mesh.instanceColor);
  assert.equal(mesh.count, 2);
  assertActive(gpu, mesh.instanceColor, 2);
  assert.equal(
    gpu.gpu(mesh.instanceMatrix)[16 + 12],
    3,
    "removal preserves visible instance order",
  );
});

test("arrow element heads and transforms survive sparse, empty and full pool updates", () => {
  const arrows = new ArrowBatches(new THREE.Scene(), 8);
  const gpu = uploads();
  const update = (items) => {
    arrows.update(items);
    for (const mesh of [arrows.shafts, ...arrows.headMeshes])
      gpu.update(mesh.instanceMatrix);
  };
  const items = ["normal", "frost", "blast", "poison", "unknown"].map(
    (effect, i) => ({
      effect,
      x: i + 1,
      z: i * -2,
      angle: i / 4,
    }),
  );
  update(items);
  assert.equal(arrows.shafts.count, 5);
  assert.deepEqual(
    arrows.headMeshes.map((mesh) => mesh.count),
    [2, 1, 1, 1],
  );
  for (const mesh of [arrows.shafts, ...arrows.headMeshes])
    assertActive(gpu, mesh.instanceMatrix, mesh.count);
  assert.equal(gpu.gpu(arrows.heads.normal.instanceMatrix)[16 + 12], 5);

  const versions = [arrows.shafts, ...arrows.headMeshes].map(
    (mesh) => mesh.instanceMatrix.version,
  );
  update([]);
  assert.deepEqual(
    [arrows.shafts, ...arrows.headMeshes].map(
      (mesh) => mesh.instanceMatrix.version,
    ),
    versions,
  );
  update([items[3]]);
  assert.equal(arrows.shafts.count, 1);
  assert.equal(arrows.heads.poison.count, 1);
  assert.equal(arrows.heads.normal.count, 0);
  assertActive(gpu, arrows.shafts.instanceMatrix, 1);
  assertActive(gpu, arrows.heads.poison.instanceMatrix, 1);
});

test("particle depth order, colours and opacity retain their exact active values", () => {
  const geometry = new THREE.OctahedronGeometry(0.1);
  const effects = [-3, 5, 1, -1].map((z, i) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xff0000 : 0x00ff00,
        transparent: true,
        opacity: 0.2 + i / 10,
      }),
    );
    mesh.position.z = z;
    return { mesh, life: i < 2 ? 1 : 0 };
  });
  const camera = new THREE.PerspectiveCamera();
  camera.position.z = 10;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const particles = new ParticleBatch(new THREE.Scene(), effects, geometry);
  const gpu = uploads();
  const upload = () => {
    particles.update(camera);
    gpu.update(particles.mesh.instanceMatrix);
    gpu.update(particles.mesh.instanceColor);
    gpu.update(particles.opacity);
    assertActive(gpu, particles.mesh.instanceMatrix, particles.mesh.count);
    assertActive(gpu, particles.mesh.instanceColor, particles.mesh.count);
    assertActive(gpu, particles.opacity, particles.mesh.count);
  };
  upload();
  assert.equal(particles.mesh.count, 2);
  assert.equal(gpu.gpu(particles.mesh.instanceMatrix)[14], -3);
  assert.equal(gpu.gpu(particles.mesh.instanceMatrix)[16 + 14], 5);
  upload(); // Consume the range left pending by Three's initial allocation.
  effects[0].life = 0;
  effects[1].mesh.material.opacity = 0.75;
  upload();
  assert.equal(particles.mesh.count, 1);
  assert.equal(gpu.gpu(particles.opacity)[0], 0.75);
  assert.equal(gpu.calls.at(-1).bytes, 4);
});

test("bow flame and lightning instance pools keep the correct bows through visibility changes", () => {
  const effects = new BowBuffEffects(new THREE.Scene(), 8);
  const players = new Map(
    ["power", "haste", "power"].map((buffType, i) => [
      i,
      {
        root: { visible: true },
        buffType,
        bow: { matrixWorld: new THREE.Matrix4().makeTranslation(i + 1, 1, 2) },
      },
    ]),
  );
  const gpu = uploads();
  const update = () => {
    effects.update(players, 1);
    for (const mesh of effects.meshes) {
      gpu.update(mesh.instanceMatrix);
      assertActive(gpu, mesh.instanceMatrix, mesh.count);
    }
  };
  update();
  assert.equal(effects.fire.count, 2);
  assert.equal(effects.lightning.count, 1);
  assert.equal(gpu.gpu(effects.fire.instanceMatrix)[16 + 12], 3);
  players.get(0).root.visible = false;
  players.get(1).buffType = "power";
  update();
  assert.equal(effects.fire.count, 2);
  assert.equal(effects.lightning.count, 0);
  assert.equal(effects.lightning.visible, false);
  assert.equal(gpu.gpu(effects.fire.instanceMatrix)[12], 2);
  for (const player of players.values()) player.root.visible = false;
  const versions = effects.meshes.map((mesh) => mesh.instanceMatrix.version);
  update();
  assert.deepEqual(
    effects.meshes.map((mesh) => mesh.instanceMatrix.version),
    versions,
  );
  assert.equal(effects.fire.visible, false);
});
