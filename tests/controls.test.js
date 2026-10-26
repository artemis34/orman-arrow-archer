import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  Controls,
  stickVector,
  floatingStickStartAllowed,
} from "../client/controls.js";
import { ArenaScene } from "../client/scene.js";
test("floating pads start only in the lower portrait/landscape thumb area", () => {
  for (const [w, h, ratio] of [
    [390, 844, 0.6],
    [375, 667, 0.6],
    [768, 1024, 0.6],
    [844, 390, 0.5],
    [568, 320, 0.5],
  ]) {
    const edge = h * ratio;
    assert.equal(floatingStickStartAllowed(edge - 0.1, w, h), false);
    assert.equal(floatingStickStartAllowed(edge, w, h), true);
    assert.equal(floatingStickStartAllowed(h, w, h), true);
    assert.equal(floatingStickStartAllowed(h + 1, w, h), false);
  }
  for (const y of [NaN, Infinity, -5])
    assert.equal(floatingStickStartAllowed(y, 390, 844), false);
  assert.equal(floatingStickStartAllowed(0, 390, 0), false);
});

test("a resting thumb is neutral and diagonal movement has a circular speed limit", () => {
  assert.deepEqual(stickVector(3, -4, 38), { x: 0, z: 0 });
  const slow = stickVector(12, 0, 38);
  assert.ok(slow.x > 0 && slow.x < 0.25);
  const diagonal = stickVector(80, -80, 38);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9);
  assert.ok(Math.abs(diagonal.x + diagonal.z) < 1e-9);
  for (const radius of [0, -1, NaN, Infinity])
    assert.deepEqual(stickVector(20, -20, radius), { x: 0, z: 0 });
});

/** Run the real stick handlers without a browser; count synchronous layout reads. */
function withSticks(check) {
  const saved = new Map(
    [
      "document",
      "addEventListener",
      "ResizeObserver",
      "innerWidth",
      "innerHeight",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const listeners = new Map(),
    observers = [],
    listen = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    };
  const event = (type, data = {}) => ({
    type,
    pointerId: 1,
    pointerType: "touch",
    clientX: 60,
    clientY: 650,
    timeStamp: 10,
    preventDefault() {},
    ...data,
  });
  const dispatch = (type, data) => {
    const e = event(type, data);
    for (const fn of listeners.get(type) || []) fn(e);
  };
  const pad = (width) => {
    const local = new Map(),
      captured = new Set(),
      knob = { style: {} },
      classes = new Set();
    return {
      width,
      reads: 0,
      knob,
      captured,
      classes,
      style: { setProperty() {} },
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
      querySelector: () => knob,
      getBoundingClientRect() {
        this.reads++;
        return { width: this.width };
      },
      addEventListener(type, fn) {
        local.set(type, fn);
      },
      fire(type, data) {
        local.get(type)?.(event(type, data));
      },
      setPointerCapture: (id) => captured.add(id),
      hasPointerCapture: (id) => captured.has(id),
      releasePointerCapture(id) {
        captured.delete(id);
        dispatch("lostpointercapture", { pointerId: id });
      },
    };
  };
  const move = pad(100),
    aim = pad(200),
    sound = [],
    controls = Object.assign(Object.create(Controls.prototype), {
      active: true,
      oneHanded: false,
      audio: { unlock() {}, play: (key) => sound.push(key) },
      joy: { x: 0, z: 0 },
      aimJoy: { x: 0, z: 0 },
      stickResets: [],
      floatingSticks: [],
    });
  try {
    Object.assign(globalThis, {
      document: { getElementById: (id) => (id === "move-stick" ? move : aim) },
      addEventListener: listen,
      ResizeObserver: class {
        constructor(callback) {
          this.callback = callback;
          observers.push(this);
        }
        observe(el) {
          this.el = el;
        }
      },
      innerWidth: 390,
      innerHeight: 844,
    });
    controls.stick("move-stick", false);
    controls.stick("aim-stick", true);
    check({
      controls,
      move,
      aim,
      dispatch,
      sound,
      resize: (el) => {
        observers.find((o) => o.el === el).callback();
      },
    });
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("independent captured sticks keep their vectors without reading layout on pointer moves", () => {
  withSticks(({ controls: c, move, aim, dispatch, sound }) => {
    move.fire("pointerdown", { pointerId: 1, clientX: 60 });
    aim.fire("pointerdown", { pointerId: 2, clientX: 300 });
    assert.equal(move.reads, 1);
    assert.equal(aim.reads, 1);
    for (let i = 0; i < 120; i++) {
      dispatch("pointermove", { pointerId: 1, clientX: 95 });
      dispatch("pointermove", { pointerId: 2, clientX: 300, clientY: 580 });
    }
    assert.deepEqual(c.joy, { x: 1, z: 0 });
    assert.deepEqual(c.aimJoy, { x: 0, z: -1 });
    assert.equal(c.charge, true);
    assert.deepEqual(sound, ["charge"]);
    assert.equal(
      move.reads,
      1,
      "120 move events use the gesture's cached size",
    );
    assert.equal(aim.reads, 1, "aim movement never measures after knob writes");
    dispatch("pointerup", { pointerId: 1, clientX: 95 });
    assert.deepEqual(c.joy, { x: 0, z: 0 });
    assert.deepEqual(c.aimJoy, { x: 0, z: -1 });
    assert.equal(c.charge, true);
    assert.equal(move.captured.size, 0);
    dispatch("pointercancel", { pointerId: 2 });
    assert.equal(c.charge, false);
    assert.equal(c.cancelShot, true);
    assert.deepEqual(c.aimJoy, { x: 0, z: 0 });
    assert.equal(aim.captured.size, 0);
    assert.equal(move.knob.style.transform, "");
    assert.equal(aim.knob.style.transform, "");
    dispatch("pointermove", { pointerId: 1, clientX: 180 });
    dispatch("pointermove", { pointerId: 2, clientX: 380 });
    assert.deepEqual(c.joy, { x: 0, z: 0 });
    assert.deepEqual(c.aimJoy, { x: 0, z: 0 });
  });
});

test("pad size changes refresh active gestures and inactive settings apply at the next press", () => {
  withSticks(({ controls: c, move, dispatch, resize }) => {
    move.fire("pointerdown", { clientX: 60 });
    dispatch("pointermove", { clientX: 95 });
    assert.equal(c.joy.x, 1);
    move.width = 200;
    resize(move);
    dispatch("pointermove", { clientX: 95 });
    assert.ok(Math.abs(c.joy.x - 0.3902439024390244) < 1e-9);
    assert.equal(move.reads, 2);
    dispatch("lostpointercapture", { pointerId: 1 });
    assert.deepEqual(c.joy, { x: 0, z: 0 });
    move.width = 50;
    resize(move);
    assert.equal(
      move.reads,
      2,
      "inactive resizing needs no synchronous measurement",
    );
    move.fire("pointerdown", { pointerId: 3, clientX: 60 });
    dispatch("pointermove", { pointerId: 3, clientX: 77.5 });
    assert.equal(
      c.joy.x,
      1,
      "the next gesture measures the newly selected size",
    );
    assert.equal(move.reads, 3);
    c.stickResets.forEach((reset) => reset());
    assert.deepEqual(c.joy, { x: 0, z: 0 });
    assert.equal(move.captured.size, 0);
  });
});

test("floating sticks can share canvas capture without releasing the other finger", () => {
  withSticks(({ controls: c, dispatch }) => {
    const captured = new Set();
    const canvas = {
      setPointerCapture: (id) => captured.add(id),
      hasPointerCapture: (id) => captured.has(id),
      releasePointerCapture(id) {
        captured.delete(id);
        dispatch("lostpointercapture", { pointerId: id });
      },
    };
    for (const [i, pointerId, clientX] of [
      [0, 3, 60],
      [1, 4, 300],
    ])
      c.floatingSticks[i].begin(
        {
          pointerId,
          pointerType: "touch",
          clientX,
          clientY: 650,
          timeStamp: 10,
          preventDefault() {},
        },
        canvas,
      );
    assert.deepEqual(captured, new Set([3, 4]));
    dispatch("pointermove", { pointerId: 3, clientX: 95 });
    dispatch("pointermove", { pointerId: 4, clientX: 300, clientY: 580 });
    dispatch("pointerup", { pointerId: 3, clientX: 95 });
    assert.deepEqual(captured, new Set([4]));
    assert.equal(c.charge, true);
    assert.deepEqual(c.aimJoy, { x: 0, z: -1 });
    dispatch("pointerup", { pointerId: 4, clientX: 300, clientY: 580 });
    assert.equal(captured.size, 0);
    assert.equal(c.charge, false);
    assert.deepEqual(c.releasedAim, { x: 0, z: -1 });
  });
});

test("unmeasurable pads stay neutral until ResizeObserver supplies their visible size", () => {
  withSticks(({ controls: c, move, dispatch, resize }) => {
    move.width = 0;
    move.fire("pointerdown", { clientX: 60 });
    dispatch("pointermove", { clientX: 95 });
    assert.deepEqual(c.joy, { x: 0, z: 0 });
    assert.equal(move.knob.style.transform, "translate(0px,0px)");
    move.width = 100;
    resize(move);
    dispatch("pointermove", { clientX: 95 });
    assert.deepEqual(c.joy, { x: 1, z: 0 });
    assert.equal(move.reads, 2);
    move.width = NaN;
    resize(move);
    dispatch("pointermove", { clientX: 60 });
    assert.deepEqual(c.joy, { x: 0, z: 0 });
  });
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
test("one-finger heal retries are bounded and classic/focus/help/guard never auto-heal", () => {
  const c = touchControls();
  c.oneHanded = c.autoHeal = true;
  c.autoHealAt = -Infinity;
  const me = { alive: true, hp: 40, maxHp: 150, healCd: 0, levelGuard: 0 };
  assert.equal(c.sample(me, null).heal, true);
  for (let i = 0; i < 60; i++) assert.equal(c.sample(me, null).heal, false);
  for (const changes of [
    { oneHanded: false },
    { autoHeal: false },
    { focused: false },
    { active: false },
  ]) {
    Object.assign(
      c,
      {
        oneHanded: true,
        autoHeal: true,
        focused: true,
        active: true,
        autoHealAt: -Infinity,
      },
      changes,
    );
    assert.equal(c.sample(me, null).heal, false);
  }
  Object.assign(c, {
    oneHanded: true,
    autoHeal: true,
    focused: true,
    active: true,
    autoHealAt: -Infinity,
  });
  assert.equal(c.sample({ ...me, levelGuard: 2 }, null).heal, false);
  c.heal = true;
  c.autoHeal = false;
  assert.equal(c.sample(me, null).heal, true, "the manual button still works");
});

test("overpull uses the movement direction once and consumes attempts during cooldown", () => {
  withSticks(({ controls: c, move, dispatch }) => {
    c.oneHanded = c.overpullDash = true;
    c.latestMe = { alive: true, dashCd: 0, levelGuard: 0 };
    move.fire("pointerdown");
    dispatch("pointermove", { clientX: 95 });
    assert.equal(c.dash, undefined);
    dispatch("pointermove", { clientX: 180 });
    assert.equal(c.dash, true);
    assert.deepEqual(c.dashVector, { x: 1, z: 0 });
    c.dash = false;
    dispatch("pointermove", { clientX: 190 });
    assert.equal(c.dash, false);
    dispatch("pointermove", { clientX: 60 });
    c.latestMe.dashCd = 1;
    dispatch("pointermove", { clientX: 180 });
    assert.equal(c.dash, false);
    c.latestMe.dashCd = 0;
    dispatch("pointermove", { clientX: 190 });
    assert.equal(c.dash, false, "cooldown expiry cannot dodge a held finger");
    dispatch("pointercancel");
    move.fire("pointerdown", { pointerId: 3 });
    dispatch("pointermove", { pointerId: 3, clientX: -60 });
    assert.equal(c.dash, true);
    assert.deepEqual(c.dashVector, { x: -1, z: 0 });
  });
});

test("a fresh joystick gesture selects a card on release without walking or dodging", () => {
  withSticks(({ controls: c, move, dispatch }) => {
    let offer = "1:draw,speed,rear";
    const picked = [],
      preview = [];
    c.oneHanded = c.overpullDash = true;
    c.upgradeChoices = () => offer;
    let tapResets = 0;
    c.tapDash = { reset: () => tapResets++ };
    c.onUpgradeChoose = (index) => picked.push(index);
    c.onUpgradePreview = (index) => preview.push(index);
    move.fire("pointerdown");
    assert.equal(
      tapResets,
      1,
      "a previous walk tap cannot chain across card selection into a dodge",
    );
    dispatch("pointermove", { clientX: 180 });
    assert.deepEqual(c.joy, { x: 0, z: 0 });
    assert.equal(c.dash, undefined);
    assert.equal(preview.at(-1), 2);
    dispatch("pointerup", { clientX: 180 });
    assert.deepEqual(picked, [2]);
    assert.equal(preview.at(-1), -1);
    move.fire("pointerdown", { pointerId: 2 });
    dispatch("pointermove", { pointerId: 2, clientX: 0 });
    dispatch("pointermove", { pointerId: 2, clientX: 60 });
    dispatch("pointerup", { pointerId: 2, clientX: 60 });
    assert.deepEqual(picked, [2], "returning to centre cancels");
    move.fire("pointerdown", { pointerId: 3 });
    dispatch("pointermove", { pointerId: 3, clientY: 580 });
    offer = "1:poison,speed,rear";
    dispatch("pointerup", { pointerId: 3, clientY: 580 });
    assert.deepEqual(
      picked,
      [2],
      "rerolled cards cannot reuse the old gesture",
    );
    move.fire("pointerdown", { pointerId: 4 });
    dispatch("pointermove", { pointerId: 4, clientY: 580 });
    dispatch("pointercancel", { pointerId: 4, clientY: 580 });
    assert.deepEqual(picked, [2], "pointer cancellation never chooses");
  });
});

test("level up during an existing walking gesture cannot accidentally choose a card", () => {
  withSticks(({ controls: c, move, dispatch }) => {
    let offer = "";
    const picked = [];
    c.oneHanded = true;
    c.upgradeChoices = () => offer;
    c.onUpgradeChoose = (index) => picked.push(index);
    move.fire("pointerdown");
    dispatch("pointermove", { clientX: 100 });
    offer = "1:draw,speed,rear";
    dispatch("pointerup", { clientX: 100 });
    assert.deepEqual(picked, []);
    move.fire("pointerdown", { pointerId: 2 });
    dispatch("pointerup", { pointerId: 2, clientY: 600 });
    assert.deepEqual(picked, [1]);
  });
});
test("displaying cards rebases the held thumb before the first intentional drag", () => {
  withSticks(({ controls: c, move, dispatch }) => {
    let offer = "";
    const picked = [];
    c.oneHanded = true;
    c.upgradeChoices = () => offer;
    c.onUpgradeChoose = (i) => {
      picked.push(i);
      offer = "";
      c.refreshUpgrade();
    };
    move.fire("pointerdown");
    dispatch("pointermove", { clientX: 100 });
    offer = "first";
    c.refreshUpgrade();
    assert.deepEqual(c.joy, { x: 0, z: 0 });
    dispatch("pointermove", { clientX: 155 });
    dispatch("pointerup", { clientX: 155 });
    assert.deepEqual(picked, [2], "one new pull is sufficient");
    move.fire("pointerdown", { pointerId: 2 });
    dispatch("pointermove", { pointerId: 2, clientX: 100 });
    offer = "second";
    c.refreshUpgrade();
    dispatch("pointerup", { pointerId: 2, clientX: 100 });
    assert.deepEqual(
      picked,
      [2],
      "releasing an unchanged walking finger never selects",
    );
  });
});
test("touch walking faces movement instead of the old mouse position", () => {
  const c = touchControls();
  assert.equal(c.sample({ alive: true }, null).angle, 0);
  c.joy = { x: 0, z: -1 };
  assert.equal(c.sample({ alive: true }, null).angle, -Math.PI / 2);
});
test("a held countdown direction starts on live combat without queueing abilities", () => {
  const c = touchControls();
  c.autoHeal = false;
  c.autoFire = true;
  c.oneHanded = true;
  c.dash = c.heal = true;
  const me = {
    id: "me",
    alive: true,
    x: 0,
    z: 0,
    hp: 150,
    maxHp: 150,
    upgrades: {},
  };
  const waiting = { players: [me], match: { phase: "waiting" } };
  const paused = c.sample(me, waiting);
  assert.equal(paused.x, 0);
  assert.equal(paused.z, 0);
  assert.equal(paused.dash, false);
  assert.equal(paused.heal, false);
  assert.equal(paused.autoFire, false);
  const live = c.sample(me, { ...waiting, match: { phase: "playing" } });
  assert.ok(live.x > 0);
  assert.equal(live.dash, false);
  assert.equal(live.heal, false);
  assert.equal(live.autoFire, true);
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
        target: new THREE.Vector3(5, 0, 4),
      });
      const radius = scene.networkRadius();
      for (const x of [-1, 1])
        for (const y of [-1, 1]) {
          scene.ray.setFromCamera(new THREE.Vector2(x, y), camera);
          scene.ray.ray.intersectPlane(scene.groundPlane, scene.intersection);
          assert.ok(
            Math.hypot(scene.intersection.x - 5, scene.intersection.z - 4) <=
              radius,
            "interest area must cover visible landscape corners",
          );
        }
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

test("a held walking finger can enter cards and confirm by dwell, then resume without lifting", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withSticks(({ controls: c, move, dispatch }) => {
    let offer = "";
    const picks = [];
    c.oneHanded = true;
    c.upgradeChoices = () => offer;
    c.onUpgradeChoose = (i) => {
      picks.push(i);
      offer = "";
    };
    move.fire("pointerdown");
    dispatch("pointermove", { clientX: 100 });
    offer = "1:speed,draw,rear";
    dispatch("pointermove", { clientX: 105 });
    assert.deepEqual(c.joy, { x: 0, z: 0 });
    dispatch("pointermove", { clientX: 190 });
    t.mock.timers.tick(599);
    assert.deepEqual(picks, []);
    t.mock.timers.tick(1);
    assert.deepEqual(picks, [2]);
    dispatch("pointermove", { clientX: 225 });
    assert.ok(c.joy.x > 0);
    assert.equal(move.captured.size, 1);
    dispatch("pointerup", { clientX: 225 });
    assert.deepEqual(picks, [2]);
  });
});

test("the reading window delays held-stick confirmation but allows an explicit early release", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  withSticks(({ controls: c, move, dispatch }) => {
    let offer = "first",
      remaining = 5000;
    const picks = [];
    c.oneHanded = true;
    c.upgradeChoices = () => offer;
    c.upgradeReadRemaining = () => remaining;
    c.onUpgradeChoose = (i) => picks.push(i);
    move.fire("pointerdown");
    dispatch("pointermove", { clientX: 180 });
    t.mock.timers.tick(4999);
    assert.deepEqual(
      picks,
      [],
      "holding a direction cannot skip the reading window",
    );
    t.mock.timers.tick(1);
    assert.deepEqual(picks, [2]);
    dispatch("pointerup", { clientX: 180 });
    offer = "second";
    move.fire("pointerdown", { pointerId: 2 });
    dispatch("pointermove", { pointerId: 2, clientX: 0 });
    dispatch("pointerup", { pointerId: 2, clientX: 0 });
    assert.deepEqual(
      picks,
      [2, 0],
      "deliberate release chooses before five seconds",
    );
    t.mock.timers.tick(5000);
    assert.deepEqual(
      picks,
      [2, 0],
      "the cancelled timer cannot duplicate an explicit selection",
    );
    remaining = 0;
    offer = "third";
    move.fire("pointerdown", { pointerId: 3 });
    t.mock.timers.tick(5000);
    assert.deepEqual(
      picks,
      [2, 0],
      "an expired reading window never chooses a card by itself",
    );
    dispatch("pointermove", { pointerId: 3, clientY: 580 });
    t.mock.timers.tick(599);
    assert.deepEqual(picks, [2, 0]);
    t.mock.timers.tick(1);
    assert.deepEqual(
      picks,
      [2, 0, 1],
      "after reading, the usual dwell stays responsive",
    );
    dispatch("pointerup", { pointerId: 3, clientY: 580 });
  });
});
