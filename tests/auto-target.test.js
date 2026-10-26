import test from "node:test";
import assert from "node:assert/strict";
import { presentationTarget } from "../client/auto-target.js";
const me = { id: "me", alive: true, x: 0, z: 0, autoTargetId: "server" };
const a = { id: "server", alive: true, x: 6, z: 0, hp: 60 },
  b = { id: "other", alive: true, x: 4, z: 4, hp: 40 };
test("reticle and bow use the authority target or explicit lock, with safe fallback", () => {
  assert.equal(presentationTarget(me, [a, b], []), a);
  assert.equal(
    presentationTarget({ ...me, lockedTargetId: b.id }, [a, b], []),
    b,
  );
  for (const change of [
    { alive: false },
    { hidden: true },
    { levelGuard: 1 },
    { spawnShield: 1 },
    { x: 30 },
  ])
    assert.equal(presentationTarget(me, [{ ...a, ...change }, b], []), b);
  assert.equal(
    presentationTarget(me, [a, b], [{ x: 3, z: 0, r: 1, type: "rock" }]),
    b,
  );
});
