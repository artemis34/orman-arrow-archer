import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { NetworkTransport, SocketTransport } from "../client/transport.js";
import { World } from "../shared/world.js";
import { advanceMovement, cleanInput, RULES } from "../shared/config.js";
import { WebSocketTransport } from "../client/websocket.js";
import {
  decodeInputs,
  SnapshotEncoder,
  SnapshotDecoder,
} from "../shared/protocol.js";

function harness() {
  const socket = new EventEmitter();
  socket.disconnect = () => {};
  const t = new SocketTransport(
    "http://example.test",
    () => {},
    () => {},
    { createSocket: () => socket },
  );
  const connecting = t.connect("Test", 0);
  socket.emit("welcome", { id: "me", obstacles: [] });
  return { t, socket, connecting };
}
const player = (changes = {}) => ({
  id: "me",
  alive: true,
  x: 0,
  z: 0,
  angle: 0,
  dashCd: 0,
  dashTime: 0,
  dashX: 0,
  dashZ: 0,
  upgrades: {},
  seq: 0,
  ...changes,
});
test("small authority corrections do not snap the local character backward", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const t = new NetworkTransport(
    () => {},
    () => {},
  );
  t.id = "me";
  t.obstacles = [];
  t.send = () => {};
  const publish = (changes) =>
    t.acceptState({ players: [player(changes)], arrows: [] });
  publish();
  t.step({ x: 1 });
  now = 10;
  const before = t.view().players[0].x;
  publish({ seq: 1, x: 0 });
  assert.ok(Math.abs(t.view().players[0].x - before) < 1e-8);
  now = 210;
  assert.ok(
    t.view().players[0].x < before,
    "the visual correction must converge instead of hiding authority",
  );
  publish({ seq: 1, x: 0, levelGuard: 3 });
  assert.equal(
    t.view().players[0].x,
    0,
    "selection protection stops visuals immediately",
  );
  publish({ seq: 1, x: 0, alive: false });
  publish({ seq: 1, x: 25 });
  assert.equal(
    t.view().players[0].x,
    25,
    "respawn cannot retain an old correction",
  );
});
test("local movement advances between input ticks without changing authoritative prediction", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const t = new NetworkTransport(
    () => {},
    () => {},
  );
  t.id = "me";
  t.obstacles = [];
  t.send = () => {};
  t.acceptState({ players: [player()], arrows: [] });
  t.step({ x: 1 });
  const start = t.view().players[0].x;
  const predicted = t.predicted.x;
  now = 1000 / 60;
  const middle = t.view().players[0].x;
  assert.ok(middle > start + 0.1 && middle < start + 0.14);
  assert.equal(
    t.predicted.x,
    predicted,
    "rendering must not accumulate simulation ticks",
  );
  now = 1000 / 30;
  const end = t.view().players[0].x;
  t.step({ x: 1 });
  assert.ok(
    Math.abs(t.view().players[0].x - end) < 1e-8,
    "next input tick continues without a jump",
  );
});
test("turning or releasing a stick cannot jump across the last input tick", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const t = new NetworkTransport(
    () => {},
    () => {},
  );
  t.id = "me";
  t.obstacles = [];
  t.send = () => {};
  t.acceptState({ players: [player()], arrows: [] });
  t.step({ x: 1 });
  now = 1000 / 30;
  const a = t.view().players[0];
  t.step({ z: 1 });
  const b = t.view().players[0];
  assert.ok(
    Math.hypot(a.x - b.x, a.z - b.z) < 1e-8,
    "a sharp turn must start from the displayed position",
  );
  now += 1000 / 30;
  const c = t.view().players[0];
  t.step({});
  const d = t.view().players[0];
  assert.ok(
    Math.hypot(c.x - d.x, c.z - d.z) < 1e-8,
    "releasing a stick must not snap backward",
  );
});
for (const binary of [false, true])
  test(`130–240 ms round-trip jitter keeps ${binary ? "batched binary" : "Socket.IO"} walking continuous`, (context) => {
    let now = 0,
      inputAt = 0,
      snapshotAt = 0;
    context.mock.method(performance, "now", () => now);
    const world = new World({ bots: 0 });
    world.obstacles = [];
    world.obstacleGrid.clear();
    while (world.orbs.active.length) world.orbs.release(0);
    Object.assign(world.addPlayer("me"), { x: -18, z: 0 });
    const queue = [];
    const t = binary
      ? new WebSocketTransport(
          "http://example.test",
          () => {},
          () => {},
        )
      : new NetworkTransport(
          () => {},
          () => {},
        );
    t.id = "me";
    t.obstacles = [];
    const serverInputs = [],
      encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const sendInput = (input) => {
      const sequence = Array.isArray(input) ? input.at(-1).seq : input.seq;
      inputAt = Math.max(
        inputAt + 1,
        now + 65 + [0, 0, 45, 0, 20, 0][sequence % 6],
      );
      queue.push({ at: inputAt, type: "input", data: input });
    };
    if (binary) {
      t.binary = true;
      t.ws = {
        readyState: 1,
        bufferedAmount: 0,
        send: (raw) => sendInput(decodeInputs(raw)),
      };
    } else t.send = (_type, input) => sendInput(input);
    t.acceptState(structuredClone(world.snapshot("me")));
    for (let n = 0; n < 78; n++) {
      queue.push({ at: (n * 1000) / 30 + 8, type: "tick" });
      queue.push({ at: (n * 1000) / 30, type: "client" });
    }
    for (let n = 0; n < 156; n++)
      queue.push({ at: (n * 1000) / 60 + 2, type: "view" });
    let previous = -18;
    const steps = [];
    while (queue.length) {
      queue.sort((a, b) => a.at - b.at);
      const event = queue.shift();
      now = event.at;
      if (event.type === "client") t.step({ x: now < 2000 ? 1 : 0 });
      if (event.type === "input") {
        if (binary) serverInputs.push(...event.data);
        else world.setInput("me", event.data);
      }
      if (event.type === "tick") {
        if (binary && serverInputs.length)
          world.setInput("me", serverInputs.shift());
        world.step();
        if (Math.round(world.time * 30) % 2 === 0) {
          snapshotAt = Math.max(
            snapshotAt + 1,
            now + 65 + [0, 55, 0, 20][Math.round(world.time * 15) % 4],
          );
          queue.push({
            at: snapshotAt,
            type: "state",
            data: binary
              ? decoder.decode(encoder.encode(world.snapshot("me")))
              : structuredClone(world.snapshot("me")),
          });
        }
      }
      if (event.type === "state") t.acceptState(event.data);
      if (event.type === "view") {
        const current = t.view().players[0].x;
        if (now > 300 && now < 1900) steps.push(current - previous);
        previous = current;
      }
    }
    assert.ok(
      Math.min(...steps) >= 0,
      "a steady thumb must never cause a backward step",
    );
    assert.ok(
      Math.max(...steps) < 0.22,
      "a delayed snapshot must not cause a double-size step",
    );
    assert.ok(
      Math.abs(t.view().players[0].x - world.players.get("me").x) < 0.05,
      "stopping converges to the server position",
    );
  });
test("input replay applies unacknowledged dash and cooldown expiration exactly like authority", () => {
  const { t, socket } = harness();
  try {
    socket.emit("state", {
      players: [player({ dashCd: 0.01 })],
      arrows: [],
      orbs: [],
    });
    t.step({ x: 1, dash: true, angle: 0 });
    const predicted = { ...t.predicted };
    socket.emit("state", {
      players: [player({ dashCd: 0.01 })],
      arrows: [],
      orbs: [],
    });
    assert.equal(t.predicted.dashTime, predicted.dashTime);
    assert.equal(t.predicted.x, predicted.x);
    assert.equal(t.predicted.dashCd, predicted.dashCd);
    assert.ok(t.predicted.x > RULES.speed / RULES.tick);
  } finally {
    t.close();
  }
});
test("shared prediction matches server movement through an entire dash and cooldown", () => {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  const p = w.addPlayer("me");
  Object.assign(p, { x: 0, z: 0, dashCd: 0.01 });
  const predicted = structuredClone(p);
  for (let tick = 0; tick < 110; tick++) {
    const i = cleanInput({
      x: 1,
      z: tick % 2 ? 0.5 : 0,
      angle: 1,
      dash: tick === 0 || tick === 91,
    });
    advanceMovement(predicted, i, 1 / RULES.tick, []);
    w.setInput("me", i);
    w.step();
    assert.ok(Math.abs(p.x - predicted.x) < 1e-9);
    assert.ok(Math.abs(p.z - predicted.z) < 1e-9);
    assert.equal(p.dashCd, predicted.dashCd);
  }
});
test("respawn transitions snap rather than sliding across the whole arena", () => {
  const { t, socket } = harness();
  try {
    t.id = "viewer";
    socket.emit("state", {
      players: [player({ alive: false, x: -25 })],
      arrows: [],
      orbs: [],
    });
    socket.emit("state", {
      players: [player({ alive: true, x: 25 })],
      arrows: [],
      orbs: [],
    });
    t.snapshots[0].at = performance.now() - 120;
    t.snapshots[1].at = performance.now();
    assert.equal(t.view().players[0].x, 25);
  } finally {
    t.close();
  }
});
test("interpolation keeps current protection, health and death on the predicted player", () => {
  const { t, socket } = harness();
  try {
    const publish = (changes) =>
      socket.emit("state", {
        players: [player(changes)],
        arrows: [],
        orbs: [],
      });
    for (let i = 0; i < 4; i++)
      publish({ x: i, hp: 100, levelGuard: 2, choices: ["draw"] });
    publish({ x: 4, hp: 64, levelGuard: 0, choices: [] });
    const now = performance.now();
    t.snapshots.forEach((s, i) => (s.at = now - (4 - i) * 33));
    let me = t.view().players[0];
    assert.equal(me.x, t.predicted.x);
    assert.equal(me.levelGuard, 0);
    assert.equal(me.hp, 64);
    assert.deepEqual(me.choices, []);
    publish({ x: 4, hp: 0, alive: false });
    me = t.view().players[0];
    assert.equal(me.alive, false);
    assert.equal(me.hp, 0);
  } finally {
    t.close();
  }
});
test("remote motion stays buffered while protection and concealment update immediately", () => {
  const { t, socket } = harness();
  try {
    t.id = "viewer";
    for (let i = 0; i < 5; i++)
      socket.emit("state", {
        players: [player({ x: i, hp: i === 4 ? 80 : 100 })],
        arrows: [],
        orbs: [],
      });
    const now = performance.now();
    t.snapshots.forEach((s, i) => (s.at = now - (4 - i) * 33));
    const remote = t.view().players[0];
    assert.ok(
      remote.x > 1 && remote.x < 2,
      "remote transforms retain smooth interpolation",
    );
    assert.equal(remote.hp, 80);
    socket.emit("state", {
      players: [player({ x: 4, levelGuard: 3 })],
      arrows: [],
      orbs: [],
    });
    assert.equal(t.view().players[0].levelGuard, 3);
    assert.equal(t.view().players[0].x, 4);
    socket.emit("state", { players: [], arrows: [], orbs: [] });
    assert.equal(
      t.view().players.length,
      0,
      "a concealed enemy cannot linger in the render buffer",
    );
  } finally {
    t.close();
  }
});
test("polling fallback works when the network refuses WebSockets", async () => {
  const http = createServer(),
    io = new Server(http, { transports: ["polling"], allowUpgrades: false });
  io.on("connection", (socket) =>
    socket.on("join", () =>
      socket.emit("welcome", { id: socket.id, obstacles: [] }),
    ),
  );
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const t = new SocketTransport(
    `http://127.0.0.1:${http.address().port}`,
    () => {},
    () => {},
    { connectTimeout: 5000 },
  );
  try {
    await t.connect("Fallback", 0);
    assert.equal(t.socket.io.engine.transport.name, "polling");
  } finally {
    t.close();
    await new Promise((resolve) => io.close(resolve));
  }
});
test("disconnect before welcome rejects promptly instead of leaving the join button stuck", async () => {
  const { t, socket } = (() => {
    const socket = new EventEmitter();
    socket.disconnect = () => {};
    return {
      t: new SocketTransport(
        "http://example.test",
        () => {},
        () => {},
        { createSocket: () => socket, connectTimeout: 5000 },
      ),
      socket,
    };
  })();
  const connecting = t.connect("Test", 0);
  socket.emit("disconnect");
  await assert.rejects(connecting, /bağlantıyı kapattı/);
  t.close();
});
