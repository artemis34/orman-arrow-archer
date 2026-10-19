import test from "node:test";
import assert from "node:assert/strict";
import { ArenaRoom } from "../cloudflare/worker.js";
import { roomCode } from "../shared/online.js";
import { ONLINE } from "../shared/online.js";
const fixture = () => {
  const room = new ArenaRoom({ getWebSockets: () => [] });
  const ws = {
    messages: [],
    send(data) {
      this.messages.push(JSON.parse(data));
    },
    close(code) {
      this.closed = code;
    },
  };
  room.sessions.set(ws, {
    id: "me",
    room: "arena",
    joined: false,
    budget: 90,
    refill: Date.now(),
    lastInput: Date.now(),
  });
  return { room, ws };
};
test("room codes normalize without allowing paths, empty codes or oversized names", () => {
  assert.equal(roomCode(" Friends-123 "), "friends-123");
  for (const value of [
    "",
    "a",
    "../arena",
    "x/arena",
    "a".repeat(25),
    {},
    null,
    "arkadaşlar",
  ])
    assert.equal(roomCode(value), null);
});
test("Cloudflare room starts on join and discards its world when the final human leaves", () => {
  const { room, ws } = fixture();
  try {
    assert.equal(room.world, null);
    assert.ok(!room.timer);
    room.webSocketMessage(
      ws,
      JSON.stringify({ type: "join", data: { name: "Archer" } }),
    );
    assert.ok(room.timer);
    assert.ok(room.world.players.has("me"));
    assert.equal(ws.messages[0].type, "welcome");
    assert.equal(ws.messages[0].data.room, "arena");
    room.remove(ws);
    assert.equal(room.world, null);
    assert.equal(room.timer, null);
    assert.equal(room.sessions.size, 0);
  } finally {
    room.remove(ws);
  }
});
test("batched snapshots preserve events from both authority ticks without duplicates", () => {
  const { room, ws } = fixture();
  try {
    room.webSocketMessage(
      ws,
      JSON.stringify({ type: "join", data: { name: "Archer" } }),
    );
    ws.messages.length = 0;
    room.world.mode.step = (world) =>
      world.events.push({ type: "round", at: world.time });
    room.step();
    assert.equal(ws.messages.length, 0);
    room.step();
    const first = ws.messages[0].data.events.filter(
      (event) => event.type === "round",
    );
    assert.equal(first.length, 2);
    room.step();
    room.step();
    const second = ws.messages[1].data.events.filter(
      (event) => event.type === "round",
    );
    assert.equal(second.length, 2);
    assert.ok(second[0].at > first[1].at);
  } finally {
    room.remove(ws);
  }
});
test("abandoned connections expire without leaving a bot-only simulation running", () => {
  const { room, ws } = fixture();
  try {
    room.webSocketMessage(
      ws,
      JSON.stringify({ type: "join", data: { name: "AFK" } }),
    );
    room.sessions.get(ws).lastInput = Date.now() - ONLINE.idleTimeout - 1;
    room.step();
    assert.equal(ws.closed, 1001);
    assert.equal(room.world, null);
    assert.equal(room.timer, null);
  } finally {
    room.remove(ws);
  }
});
test("a failed welcome send cannot restart a world after its last session is removed", () => {
  const { room, ws } = fixture();
  ws.send = () => {
    throw new Error("closed connection");
  };
  room.webSocketMessage(
    ws,
    JSON.stringify({ type: "join", data: { name: "Gone" } }),
  );
  assert.equal(room.world, null);
  assert.equal(room.timer, null);
});
