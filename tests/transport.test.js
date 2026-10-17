import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { SocketTransport } from "../client/transport.js";
import { World } from "../shared/world.js";
import { advanceMovement, cleanInput, RULES } from "../shared/config.js";

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
