import test from "node:test";
import assert from "node:assert/strict";
import {
  OverpullDash,
  automaticHealReady,
  joystickCard,
  matchAllowsInput,
  cooldownText,
} from "../client/one-finger.js";

test("dash targets remain fixed along any chosen direction and require actual contact", () => {
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI / 4]) {
    const d = new OverpullDash(),
      x = Math.cos(angle),
      y = Math.sin(angle);
    assert.equal(d.move(40 * x, 40 * y, 40), false);
    assert.equal(d.target, null);
    assert.equal(d.move(50 * x, 50 * y, 40), false);
    const target = { ...d.target };
    assert.ok(Math.abs(Math.hypot(target.x, target.y) - 124) < 1e-8);
    assert.equal(d.move(70 * x, 70 * y, 40), false);
    assert.deepEqual(d.target, target);
    assert.equal(d.move(124 * x, 124 * y, 40), true);
    for (let i = 0; i < 300; i++)
      assert.equal(d.move(140 * x, 140 * y, 40), false);
    d.move(0, 0, 40);
    assert.equal(
      d.move(160 * x, 160 * y, 40),
      true,
      "fast drags sweep through the target",
    );
  }
});
test("cooldowns never say zero before ready and all modes gate commands on live combat", () => {
  assert.equal(cooldownText(0), "");
  assert.equal(cooldownText(0.01), "1");
  assert.equal(cooldownText(0.01, true), "0.1");
  assert.equal(cooldownText(2.31, true), "2.4");
  assert.equal(cooldownText(NaN), "");
  assert.equal(matchAllowsInput(null), true);
  assert.equal(matchAllowsInput({ phase: "playing" }), true);
  for (const phase of ["waiting", "results"])
    assert.equal(matchAllowsInput({ phase }), false);
});

test("card directions map left, up, right and allow centre/downward cancellation", () => {
  for (const [x, y, expected] of [
    [-40, 0, 0],
    [0, -40, 1],
    [40, 0, 2],
    [-40, -15, 0],
    [40, -15, 2],
    [15, -40, 1],
    [0, 0, -1],
    [15, 0, -1],
    [0, 40, -1],
    [15, 40, -1],
  ])
    assert.equal(joystickCard(x, y, 40), expected);
  assert.equal(joystickCard(NaN, 0, 40), -1);
  assert.equal(joystickCard(40, 0, 0), -1);
});

test("automatic healing uses relative HP and respects authoritative life, guard and cooldown", () => {
  const me = { alive: true, hp: 52.5, maxHp: 150, healCd: 0, levelGuard: 0 };
  assert.equal(automaticHealReady(me), true);
  for (const change of [
    { hp: 52.6 },
    { hp: 0 },
    { alive: false },
    { levelGuard: 0.1 },
    { healCd: 0.001 },
    { maxHp: 0 },
  ])
    assert.equal(automaticHealReady({ ...me, ...change }), false);
  assert.equal(automaticHealReady({ ...me, hp: 70, maxHp: 200 }), true);
  assert.equal(automaticHealReady(null), false);
});

test("further dash targets remain reachable at the screen boundary", () => {
  const d = new OverpullDash();
  d.move(50, 0, 40, { minX: -180, maxX: 80, minY: -700, maxY: 100 });
  assert.equal(d.target.x, 80);
  assert.equal(
    d.move(80, 0, 40, { minX: -180, maxX: 80, minY: -700, maxY: 100 }),
    true,
  );
});
