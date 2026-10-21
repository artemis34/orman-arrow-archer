import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BowBuffEffects } from "../client/bow-buff-effects.js";

function archer(buffType, visible = true) {
  const root = new THREE.Group(),
    bow = new THREE.Group();
  root.visible = visible;
  root.add(bow);
  return { root, bow, buffType };
}
test("bow effects switch type, hide dead/camouflaged players and reuse their buffers after expiry", () => {
  const scene = new THREE.Scene(),
    effects = new BowBuffEffects(scene);
  const power = archer("power"),
    haste = archer("haste"),
    hidden = archer("power", false);
  const views = new Map([
    ["power", power],
    ["haste", haste],
    ["hidden", hidden],
  ]);
  const buffers = [
    effects.fire.instanceMatrix,
    effects.lightning.instanceMatrix,
  ];
  effects.update(views, 1);
  assert.equal(effects.fire.count, 1);
  assert.equal(effects.lightning.count, 1);
  power.buffType = null;
  haste.root.visible = false;
  effects.update(views, 2);
  assert.equal(effects.fire.visible, false);
  assert.equal(effects.lightning.visible, false);
  power.buffType = "haste";
  effects.update(views, 3);
  assert.equal(effects.fire.count, 0);
  assert.equal(effects.lightning.count, 1);
  assert.equal(effects.fire.instanceMatrix, buffers[0]);
  assert.equal(effects.lightning.instanceMatrix, buffers[1]);
});
test("effects follow the posed bow transform, including movement, turning and aiming", () => {
  const effects = new BowBuffEffects(new THREE.Scene()),
    view = archer("power");
  view.root.position.set(7, 0.2, -3);
  view.root.rotation.y = 1.2;
  view.bow.position.set(0.45, 0.03, 0.1);
  view.bow.rotation.z = 0.8;
  view.root.updateMatrixWorld();
  effects.update(new Map([["player", view]]), 2);
  const uploaded = new THREE.Matrix4();
  effects.fire.getMatrixAt(0, uploaded);
  for (let i = 0; i < 16; i++)
    assert.ok(
      Math.abs(uploaded.elements[i] - view.bow.matrixWorld.elements[i]) < 1e-6,
    );
});
test("bow effect capacity is bounded and unknown buffs never produce an effect", () => {
  const effects = new BowBuffEffects(new THREE.Scene(), 2);
  effects.update(
    new Map([
      [1, archer("power")],
      [2, archer("power")],
      [3, archer("power")],
      [4, archer("unknown")],
    ]),
    1,
  );
  assert.equal(effects.fire.count, 2);
  assert.equal(effects.lightning.count, 0);
});
