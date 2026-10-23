import test from "node:test";
import assert from "node:assert/strict";
import {
  controlModeFor,
  saveControlMode,
} from "../client/control-preferences.js";

const store = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => values.set(key, value),
  };
};

test("new phones open in one-hand mode and mouse computers use classic controls", () => {
  const prefs = store();
  assert.equal(controlModeFor({ touch: true, get: prefs.get }), "onehand");
  assert.equal(controlModeFor({ touch: false, get: prefs.get }), "classic");
});

test("a saved phone mode never silently changes desktop WASD/mouse behavior", () => {
  for (const legacy of ["classic", "onehand"]) {
    const prefs = store({ "wildbow-controls": legacy });
    saveControlMode({ touch: true, mode: "onehand", set: prefs.set });
    assert.equal(controlModeFor({ touch: false, get: prefs.get }), "classic");
  }
});

test("the old automatically saved classic default cannot block the mobile one-hand rollout", () => {
  for (const legacy of ["classic", "onehand"]) {
    const prefs = store({ "wildbow-controls": legacy });
    assert.equal(controlModeFor({ touch: true, get: prefs.get }), "onehand");
  }
});

test("explicit per-device choices survive reload and remain independent", () => {
  const prefs = store();
  assert.equal(
    saveControlMode({ touch: true, mode: "classic", set: prefs.set }),
    "classic",
  );
  saveControlMode({ touch: false, mode: "onehand", set: prefs.set });
  assert.equal(controlModeFor({ touch: true, get: prefs.get }), "classic");
  assert.equal(controlModeFor({ touch: false, get: prefs.get }), "onehand");
  assert.equal(prefs.get("wildbow-controls"), "onehand");
});

test("invalid stored modes fall back safely and invalid saves preserve the selected layout", () => {
  const prefs = store({
    "wildbow-controls-touch": "invalid",
    "wildbow-controls-desktop": "__proto__",
  });
  assert.equal(controlModeFor({ touch: true, get: prefs.get }), "onehand");
  assert.equal(controlModeFor({ touch: false, get: prefs.get }), "classic");
  saveControlMode({ touch: true, mode: "classic", set: prefs.set });
  assert.equal(
    saveControlMode({ touch: true, mode: "invalid", set: prefs.set }),
    null,
  );
  assert.equal(controlModeFor({ touch: true, get: prefs.get }), "classic");
});

test("missing or blocked storage leaves controls available", () => {
  const denied = () => {
    throw new Error("storage blocked");
  };
  assert.equal(controlModeFor({ touch: true, get: denied }), "onehand");
  assert.equal(controlModeFor({ touch: false, get: denied }), "classic");
  assert.equal(
    saveControlMode({ touch: true, mode: "classic", set: denied }),
    "classic",
  );
  assert.equal(controlModeFor(), "classic");
  assert.equal(saveControlMode({ mode: "onehand" }), "onehand");
});
