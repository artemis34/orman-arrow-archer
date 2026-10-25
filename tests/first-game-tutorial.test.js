import test from "node:test";
import assert from "node:assert/strict";
import { FirstGameTutorial } from "../client/first-game-tutorial.js";
function fixture() {
  const data = new Map();
  const finished = [];
  let skip;
  const ui = {
    root: { classList: { toggle: (key, hidden) => (ui.hidden = hidden) } },
    title: {},
    note: {},
    skip: { addEventListener: (_, fn) => (skip = fn) },
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
    onFinish: (reason) => finished.push(reason),
  };
  return {
    t: new FirstGameTutorial(ui),
    ui,
    data,
    finished,
    skip: () => skip(),
  };
}
test("first-match tutorial advances only through gameplay and persists completion", () => {
  const { t, ui } = fixture();
  t.start(true);
  const me = { alive: true, x: 0, z: 0, dashCd: 0, shotCd: 0, upgrades: {} };
  t.observe(me);
  assert.equal(t.step, 0);
  t.observe({ ...me, x: 3 });
  assert.equal(t.step, 1);
  t.observe({ ...me, dashCd: 2 });
  assert.equal(t.step, 2);
  t.observe({ ...me, shotCd: 0.5 });
  assert.equal(t.step, 3);
  t.observe({ ...me, upgrades: { speed: 1 } });
  assert.equal(ui.hidden, true);
  t.start(true);
  assert.equal(ui.hidden, true);
});
test("skipping is persistent and death never counts as a tutorial movement", () => {
  const { t, ui, skip } = fixture();
  t.start(false);
  t.observe({ alive: false, x: 90, z: 90 });
  assert.equal(t.step, 0);
  skip();
  t.start(false);
  assert.equal(ui.hidden, true);
});

test("non-progression lessons finish without demanding nonexistent upgrades", () => {
  const { t, ui } = fixture();
  t.start(true, false);
  const me = { alive: true, x: 0, z: 0, dashCd: 0, shotCd: 0, upgrades: {} };
  t.observe(me);
  t.observe({ ...me, x: 3 });
  t.observe({ ...me, dashCd: 2 });
  t.observe({ ...me, shotCd: 0.5 });
  assert.equal(ui.hidden, true);
});
test("an explicit lesson can be replayed and stop never calls the completion callback", () => {
  const { t, ui, data, skip, finished } = fixture();
  data.set("wildbow-tutorial-v1", "done");
  t.start(true, true, true);
  assert.equal(ui.hidden, false);
  skip();
  assert.deepEqual(finished, ["skipped"]);
  t.start(false, true, true);
  t.stop();
  assert.equal(ui.hidden, true);
  assert.deepEqual(finished, ["skipped"]);
  t.start(true, true, true);
  t.finish();
  t.finish();
  assert.deepEqual(finished, ["skipped", "completed"]);
});
