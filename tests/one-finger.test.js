import test from "node:test";
import assert from "node:assert/strict";
import {
  OverpullDash,
  automaticHealReady,
  joystickCard,
} from "../client/one-finger.js";

test("overpull dodges once, rearms inside the pad and never fires on a normal walk", () => {
  const pull = new OverpullDash();
  for (const distance of [0, 12, 38, 50, 70])
    assert.equal(pull.move(distance, 40), false);
  assert.equal(pull.move(74, 40), true);
  for (let i = 0; i < 300; i++) assert.equal(pull.move(100, 40), false);
  assert.equal(pull.move(39, 40), false);
  assert.equal(
    pull.move(75, 40),
    false,
    "hysteresis prevents boundary chatter",
  );
  assert.equal(pull.move(30, 40), false);
  assert.equal(pull.move(80, 40), true);
  pull.reset();
  assert.equal(pull.move(80, 40), true);
  for (const [d, r] of [
    [NaN, 40],
    [100, 0],
    [100, Infinity],
  ])
    assert.equal(pull.move(d, r), false);
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
