import test from "node:test";
import assert from "node:assert/strict";
import worker, { ArenaRoom, ArenaMatchmaker } from "../cloudflare/worker.js";
import {
  PROTOCOL,
  decodePacket,
  encodeInputs,
  SnapshotDecoder,
} from "../shared/protocol.js";
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
test("matchmaking tickets cannot be cached and configured external frontends get CORS", async () => {
  let allocations = 0;
  const env = {
    ALLOWED_ORIGINS: "https://frontend.example",
    MATCHMAKER: {
      idFromName: (x) => x,
      get: () => ({
        fetch: async () => {
          allocations++;
          return Response.json({ room: "wildbow-1", ticket: "one-use" });
        },
      }),
    },
  };
  const allowed = await worker.fetch(
    new Request("https://game.example/api/matchmake", {
      headers: { Origin: "https://frontend.example" },
    }),
    env,
  );
  assert.equal(
    allowed.headers.get("Access-Control-Allow-Origin"),
    "https://frontend.example",
  );
  assert.equal(allowed.headers.get("Cache-Control"), "no-store");
  const denied = await worker.fetch(
    new Request("https://game.example/api/matchmake", {
      headers: { Origin: "https://evil.example" },
    }),
    env,
  );
  assert.equal(denied.status, 403);
  assert.equal(allocations, 1, "a rejected origin cannot reserve a seat");
});
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
test("binary input batches advance one authority frame per tick and preserve press/release", () => {
  const { room, ws } = fixture();
  const states = new SnapshotDecoder();
  ws.send = (packet) =>
    ws.messages.push(
      typeof packet === "string"
        ? JSON.parse(packet)
        : { type: "state", data: states.decode(packet) },
    );
  try {
    room.webSocketMessage(
      ws,
      JSON.stringify({
        type: "join",
        data: { name: "Binary", protocol: PROTOCOL },
      }),
    );
    room.webSocketMessage(
      ws,
      encodeInputs([
        { seq: 1, x: 1, z: 0, angle: 0, charge: true },
        { seq: 2, x: 1, z: 0, angle: 0, charge: false },
      ]),
    );
    const p = room.world.players.get("me"),
      x = p.x;
    room.step();
    assert.equal(p.seq, 1);
    assert.equal(p.input.charge, true);
    assert.ok(Math.abs(p.x - x) <= 0.26);
    room.step();
    assert.equal(p.seq, 2);
    assert.equal(p.input.charge, false);
    assert.equal(ws.messages[0].data.protocol, PROTOCOL);
  } finally {
    room.remove(ws);
  }
});
test("matchmaking reserves seats atomically, spills over and reuses available rooms", async () => {
  const rooms = new Map(),
    storage = new Map();
  let loading;
  const env = {
    ARENAS: {
      idFromName: (name) => name,
      get: (name) => {
        if (!rooms.has(name))
          rooms.set(name, new ArenaRoom({ getWebSockets: () => [] }));
        return rooms.get(name);
      },
    },
  };
  const directory = new ArenaMatchmaker(
    {
      storage: {
        get: async (k) => storage.get(k),
        put: async (k, v) => storage.set(k, v),
      },
      blockConcurrencyWhile: (fn) => (loading = fn()),
    },
    env,
  );
  await loading;
  try {
    const first = await Promise.all(
      Array.from({ length: 17 }, async () => {
        const r = await directory.fetch(new Request("https://internal/find"));
        assert.equal(r.status, 200);
        return r.json();
      }),
    );
    assert.equal(first.filter((x) => x.room === "wildbow-1").length, 16);
    assert.equal(first.filter((x) => x.room === "wildbow-2").length, 1);
    assert.equal(new Set(first.map((x) => x.ticket)).size, 17);
    const one = rooms.get("wildbow-1"),
      ticket = first[0].ticket;
    clearTimeout(one.reservations.get(ticket));
    one.reservations.delete(ticket);
    await directory.fetch(
      new Request("https://internal/available", {
        method: "POST",
        body: JSON.stringify({ room: "wildbow-1" }),
      }),
    );
    const reused = await (
      await directory.fetch(new Request("https://internal/find"))
    ).json();
    assert.equal(reused.room, "wildbow-1");
  } finally {
    for (const room of rooms.values())
      for (const timer of room.reservations.values()) clearTimeout(timer);
  }
});
