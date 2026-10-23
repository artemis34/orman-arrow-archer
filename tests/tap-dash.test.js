import test from "node:test";
import assert from "node:assert/strict";
import { TapDashDetector } from "../client/tap-dash.js";

const tap = (startedAt, x = 100, y = 200, overrides = {}) => ({
  x,
  y,
  startedAt,
  endedAt: startedAt + 60,
  ...overrides,
});

test("two nearby short touches trigger one dash while the first touch does not", () => {
  const d = new TapDashDetector();
  assert.equal(d.release(tap(0)), false);
  assert.equal(d.release(tap(140, 120, 220)), true);
  assert.equal(d.last, null);
});

test("touch duration, distance and inter-tap time accept their exact inclusive limits", () => {
  const d = new TapDashDetector();
  assert.equal(d.release(tap(0, 100, 200, { endedAt: 180 })), false);
  assert.equal(d.release(tap(460, 132, 200, { endedAt: 640 })), true);
});

test("successful pairs are consumed so a third tap cannot immediately dash again", () => {
  const d = new TapDashDetector();
  assert.equal(d.release(tap(0)), false);
  assert.equal(d.release(tap(120)), true);
  assert.equal(d.release(tap(240)), false);
  assert.equal(d.release(tap(360)), true);
});

test("dragging, cancellation, mouse input and a long hold discard any pending tap", () => {
  for (const overrides of [
    { dragged: true },
    { cancelled: true },
    { pointerType: "mouse" },
    { pointerType: "pen" },
    { endedAt: 301 },
  ]) {
    const d = new TapDashDetector();
    d.release(tap(0));
    assert.equal(d.release(tap(120, 100, 200, overrides)), false);
    assert.equal(d.last, null);
    assert.equal(d.release(tap(400)), false);
    assert.equal(d.release(tap(520)), true);
  }
});

test("a far or late otherwise valid tap becomes the beginning of a new pair", () => {
  for (const second of [tap(120, 132.01), tap(341)]) {
    const d = new TapDashDetector();
    d.release(tap(0));
    assert.equal(d.release(second), false);
    assert.equal(d.release(tap(second.endedAt + 30, second.x, second.y)), true);
  }
});

test("backwards timestamps cannot dash or arm the next gesture", () => {
  for (const backward of [
    tap(120, 100, 200, { endedAt: 119 }),
    tap(20, 100, 200, { endedAt: 50 }),
  ]) {
    const d = new TapDashDetector();
    d.release(tap(100));
    assert.equal(d.release(backward), false);
    assert.equal(d.last, null);
    assert.equal(d.release(tap(200)), false);
  }
});

test("nonfinite or missing coordinates and timestamps clear pending gestures", () => {
  for (const field of ["x", "y", "startedAt", "endedAt"])
    for (const invalid of [NaN, Infinity, -Infinity, undefined, "120"]) {
      const d = new TapDashDetector();
      d.release(tap(0));
      assert.equal(d.release(tap(120, 100, 200, { [field]: invalid })), false);
      assert.equal(d.last, null);
      assert.equal(d.release(tap(240)), false);
    }
  assert.equal(new TapDashDetector().release(), false);
});

test("focus/layout resets prevent an old tap from participating in a dash", () => {
  const d = new TapDashDetector();
  d.release(tap(0));
  d.reset();
  assert.equal(d.release(tap(120)), false);
  assert.equal(d.release(tap(240)), true);
});
