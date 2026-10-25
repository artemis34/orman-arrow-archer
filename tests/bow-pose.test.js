import test from "node:test";
import assert from "node:assert/strict";
import { BowPose } from "../client/bow-pose.js";
const player = { alive: true, levelGuard: 0, charge: 0, shotCd: 0 };
test("manual charge draws smoothly and cancelling cannot synthesize a shot", () => {
  const b = new BowPose(player);
  for (let i = 0; i < 30; i++) b.update({ ...player, charge: 1 }, 1 / 60);
  assert.ok(b.draw > 0.99);
  b.update(player, 1 / 60);
  assert.equal(b.recoil, 0);
  assert.equal(b.release, 0);
  assert.ok(b.draw < 1);
});
test("an authoritative automatic shot releases a visible arrow and draws the next one", () => {
  const b = new BowPose(player);
  b.update({ ...player, shotCd: 0.65 }, 1 / 60, true);
  assert.equal(b.recoil, 1);
  assert.ok(b.release > 0);
  for (let i = 0; i < 36; i++)
    b.update(
      { ...player, shotCd: Math.max(0, 0.65 - (i + 1) / 60) },
      1 / 60,
      true,
    );
  assert.ok(b.draw > 0.4);
  assert.equal(b.release, 0);
  b.update({ ...player, shotCd: 0.65 }, 1 / 60, true);
  assert.equal(b.recoil, 1);
});
test("repeated snapshots do not repeatedly fire and death or protection clears the pose", () => {
  const b = new BowPose(player);
  b.update({ ...player, shotCd: 0.6 }, 0.016);
  const r = b.recoil;
  b.update({ ...player, shotCd: 0.6 }, 0.016);
  assert.ok(b.recoil < r);
  b.update({ ...player, alive: false }, 0.016);
  assert.equal(b.release, 0);
  assert.equal(b.draw, 0);
  b.update({ ...player, levelGuard: 3 }, 0.016);
  assert.equal(b.draw, 0);
});
