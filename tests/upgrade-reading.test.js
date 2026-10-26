import test from "node:test";
import assert from "node:assert/strict";
import { UpgradeReadingWindow } from "../client/upgrade-reading.js";
test("hidden or collapsed time cannot consume the five visible reading seconds", () => {
  const r = new UpgradeReadingWindow();
  r.start(100);
  assert.equal(r.remaining(1100), 4000);
  r.pause(2100);
  assert.equal(r.remaining(99000), 3000);
  r.pause(100000);
  r.resume(101000);
  assert.equal(r.remaining(103999), 1);
  assert.equal(r.remaining(104000), 0);
  r.clear();
  assert.equal(r.remaining(200000), 0);
  r.start(210000);
  assert.equal(r.remaining(210000), 5000);
});
