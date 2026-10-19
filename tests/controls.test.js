import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Controls, stickVector } from "../client/controls.js";
import { ArenaScene } from "../client/scene.js";

test("a resting thumb is neutral and diagonal movement has a circular speed limit", () => {
  assert.deepEqual(stickVector(3, -4, 38), { x: 0, z: 0 });
  const slow = stickVector(12, 0, 38);
  assert.ok(slow.x > 0 && slow.x < 0.25);
  const diagonal = stickVector(80, -80, 38);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9);
  assert.ok(Math.abs(diagonal.x + diagonal.z) < 1e-9);
});

function touchControls() {
  return Object.assign(Object.create(Controls.prototype), {
    active: true,
    keys: new Set(),
    isTouch: true,
    joy: { x: 1, z: 0 },
    aimJoy: { x: 0, z: 0 },
    angle: 0.7,
    charge: false,
    releasedAim: null,
    autoFire: false,
    mouse: { x: 0, y: 0 },
    scene: {
      aimAt() {
        throw new Error("touch must not use a stale mouse position");
      },
      aimFromStick(x, z) {
        return Math.atan2(z, x);
      },
    },
  });
}
test("touch walking faces movement instead of the old mouse position", () => {
  const c = touchControls();
  assert.equal(c.sample({ alive: true }, null).angle, 0);
  c.joy = { x: 0, z: -1 };
  assert.equal(c.sample({ alive: true }, null).angle, -Math.PI / 2);
});
test("walking and aiming remain independent when either stick is released", () => {
  const c = touchControls();
  c.charge = true;
  c.aimJoy = { x: 0, z: -1 };
  let input = c.sample({ alive: true }, null);
  assert.equal(input.x, 1);
  assert.equal(input.angle, -Math.PI / 2);
  c.joy = { x: 0, z: 0 };
  input = c.sample({ alive: true }, null);
  assert.equal(input.x, 0);
  assert.equal(input.charge, true);
  c.joy = { x: 1, z: 0 };
  c.charge = false;
  c.aimJoy = { x: 0, z: 0 };
  input = c.sample({ alive: true }, null);
  assert.equal(input.x, 1);
  assert.equal(input.charge, false);
  assert.equal(input.angle, 0, "the torso follows walking after aiming ends");
});

test("the release keeps the aimed shot, then walking and quick taps cannot lock the torso", () => {
  const c = touchControls();
  c.releasedAim = { x: 0, z: -1 };
  assert.equal(c.sample({ alive: true }, null).angle, -Math.PI / 2);
  assert.equal(c.sample({ alive: true }, null).angle, 0);
  const me = { id: "me", x: 0, z: 0, alive: true };
  const target = { id: "enemy", x: 0, z: -10, alive: true, hp: 10 };
  c.quickShot = true;
  assert.equal(c.sample(me, { players: [me, target] }).angle, -Math.PI / 2);
  c.joy = { x: 0, z: 1 };
  assert.equal(c.sample(me, { players: [me, target] }).angle, Math.PI / 2);
});

test("one-handed fire aims at valid enemies without changing movement or manual aim", () => {
  const c = touchControls();
  const me = { id: "me", x: 0, z: 0, alive: true };
  const target = { id: "enemy", x: 0, z: -10, alive: true, hp: 10 };
  const state = { players: [me, target] };
  c.setAutoFire(true);
  let input = c.sample(me, state);
  assert.equal(input.autoFire, true);
  assert.equal(input.angle, -Math.PI / 2);
  assert.equal(input.x, 1);
  c.charge = true;
  c.aimJoy = { x: -1, z: 0 };
  input = c.sample(me, state);
  assert.equal(
    input.angle,
    Math.PI,
    "manual aim wins over the automatic target",
  );
  assert.equal(input.charge, true);
  c.charge = false;
  c.setAutoFire(false);
  input = c.sample(me, state);
  assert.equal(input.autoFire, false);
  assert.equal(input.angle, 0);
});

test("automatic fire is suspended during help, focus loss and death", () => {
  const c = touchControls();
  c.setAutoFire(true);
  c.focused = false;
  c.cancelShot = true;
  let input = c.sample({ alive: true }, null);
  assert.equal(input.autoFire, false);
  assert.equal(input.cancelShot, true);
  c.focused = true;
  c.active = false;
  c.cancelShot = true;
  input = c.sample({ alive: true }, null);
  assert.equal(input.autoFire, false);
  assert.equal(input.cancelShot, true);
  c.active = true;
  assert.equal(c.sample({ alive: false }, null).autoFire, false);
  assert.equal(c.sample({ alive: true }, null).autoFire, true);
});

test("diagonal joystick directions match the tilted camera on portrait and landscape screens", () => {
  const previous = [globalThis.innerWidth, globalThis.innerHeight];
  try {
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ]) {
      globalThis.innerWidth = width;
      globalThis.innerHeight = height;
      const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 180);
      camera.position.set(5, 32, 28);
      camera.lookAt(5, 0, 4);
      camera.updateMatrixWorld();
      const scene = Object.assign(Object.create(ArenaScene.prototype), {
        camera,
        screenOrigin: new THREE.Vector3(),
        pointer: new THREE.Vector2(),
        ray: new THREE.Raycaster(),
        intersection: new THREE.Vector3(),
        groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      });
      const p = { x: 4, z: 3 };
      for (const [x, z] of [
        [1, -1],
        [-1, 1],
        [1, 0],
        [0, -1],
      ]) {
        const angle = scene.aimFromStick(x, z, p);
        const a = new THREE.Vector3(p.x, 0, p.z).project(camera);
        const b = new THREE.Vector3(
          p.x + Math.cos(angle),
          0,
          p.z + Math.sin(angle),
        ).project(camera);
        const screenAngle = Math.atan2(
          -(b.y - a.y) * height,
          (b.x - a.x) * width,
        );
        const error = Math.atan2(
          Math.sin(screenAngle - Math.atan2(z, x)),
          Math.cos(screenAngle - Math.atan2(z, x)),
        );
        assert.ok(
          Math.abs(error) < 1e-8,
          `thumb direction must match screen in ${width}x${height}`,
        );
      }
    }
  } finally {
    [globalThis.innerWidth, globalThis.innerHeight] = previous;
  }
});
