import { annotateFailure } from "./report.js";
import { io } from "socket.io-client";
import assert from "node:assert/strict";
const url = process.env.TEST_SERVER_URL || "http://127.0.0.1:3000";
const sockets = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function join(name) {
  const socket = io(url, { transports: ["websocket"], reconnection: false });
  sockets.push(socket);
  let latest;
  socket.on("state", (s) => {
    latest = s;
  });
  const welcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Join timeout")), 5000);
    socket.on("connect", () => socket.emit("join", { name, skin: 1 }));
    socket.on("welcome", (data) => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.on("connect_error", reject);
  });
  return { socket, id: welcome.id, state: () => latest };
}
try {
  const a = await join("Network A"),
    b = await join("Network B");
  // Drawing reveals an archer, so shared-world assertions also work when a
  // safe spawn happens to be inside a camouflage bush. Keep all game rules on.
  a.socket.emit("input", { charge: true });
  b.socket.emit("input", { charge: true });
  await wait(150);
  assert.ok(a.state().players.some((p) => p.id === b.id));
  assert.ok(b.state().players.some((p) => p.id === a.id));
  const before = a.state().players.find((p) => p.id === a.id);
  a.socket.emit("input", {
    x: 0,
    z: 0,
    position: { x: 999, z: 999 },
    hp: 999,
    damage: 999,
    charge: true,
    seq: 1,
  });
  await wait(100);
  let after = a.state().players.find((p) => p.id === a.id);
  assert.equal(after.x, before.x);
  assert.equal(after.z, before.z);
  assert.equal(after.hp, after.maxHp);
  assert.equal(after.seq, 1);
  a.socket.emit("input", { x: 1, z: 0, angle: 0, charge: true, seq: 2 });
  const holding = setInterval(
    () =>
      a.socket.emit("input", { x: 1, z: 0, angle: 0, charge: true, seq: 2 }),
    50,
  );
  await wait(400);
  clearInterval(holding);
  after = a.state().players.find((p) => p.id === a.id);
  assert.ok(after.x > before.x);
  assert.ok(after.charge > 0.2);
  a.socket.emit("input", { x: 0, z: 0, charge: false, seq: 3 });
  await wait(80);
  assert.equal(a.state().players.find((p) => p.id === a.id).charge, 0);
  assert.equal(b.state().players.find((p) => p.id === a.id).seq, 3);
  a.socket.emit("upgrade", "hacked");
  await wait(70);
  assert.equal(
    a.state().players.find((p) => p.id === a.id).upgrades.hacked,
    undefined,
  );
  a.socket.disconnect();
  await wait(100);
  assert.ok(!b.state().players.some((p) => p.id === a.id));
  const health = await (await fetch(url + "/health")).json();
  assert.equal(health.tickRate, 30);
  console.log(
    "Network smoke passed: two real clients, shared state, authoritative movement/charge, forged data rejection, disconnect cleanup, health check.",
  );
} catch (error) {
  annotateFailure(error, "Two-client network validation");
  throw error;
} finally {
  for (const s of sockets) s.disconnect();
}
