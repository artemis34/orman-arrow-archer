import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketTransport } from "../client/websocket.js";
import { PROTOCOL, SnapshotEncoder, decodeInputs } from "../shared/protocol.js";
class Socket extends EventTarget {
  readyState = 0;
  bufferedAmount = 0;
  sent = [];
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(packet) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(packet) }),
    );
  }
  send(data) {
    this.sent.push(
      typeof data === "string"
        ? JSON.parse(data)
        : { type: "input-batch", data: decodeInputs(data) },
    );
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}
function fixture(options = {}) {
  const ws = new Socket();
  let address,
    disconnected = 0;
  const transport = new WebSocketTransport(
    "https://game.example",
    () => {},
    () => disconnected++,
    {
      createWebSocket: (url) => {
        address = url;
        return ws;
      },
      ...options,
    },
  );
  return {
    ws,
    transport,
    address: () => address,
    disconnected: () => disconnected,
  };
}
function welcome(ws) {
  ws.open();
  ws.message({
    type: "welcome",
    data: { id: "me", room: "friends", obstacles: [] },
  });
}
test("Cloudflare adapter joins a secure room and shares sequence-based movement prediction", async () => {
  const { ws, transport, address } = fixture({ room: "Friends" });
  try {
    const connecting = transport.connect("Archer", 2);
    welcome(ws);
    await connecting;
    assert.equal(address(), "wss://game.example/api/rooms/friends");
    assert.deepEqual(ws.sent[0], {
      type: "join",
      data: { name: "Archer", skin: 2, protocol: PROTOCOL, viewRadius: 34 },
    });
    ws.message({
      type: "state",
      data: {
        players: [
          {
            id: "me",
            alive: true,
            x: 0,
            z: 0,
            angle: 0,
            seq: 0,
            dashCd: 0,
            dashTime: 0,
            upgrades: {},
          },
        ],
        arrows: [],
        orbs: [],
      },
    });
    transport.step({ x: 1, angle: 0 });
    assert.ok(transport.predicted.x > 0);
    assert.equal(ws.sent.at(-1).data.seq, 1);
    assert.equal(ws.sent.at(-1).type, "input");
    transport.choose("draw");
    assert.deepEqual(ws.sent.at(-1), { type: "upgrade", data: "draw" });
    transport.respawn();
    assert.equal(ws.sent.at(-1).type, "respawn");
  } finally {
    transport.close();
  }
});
test("binary clients batch 30 prediction steps into 15 packets and send releases immediately", async () => {
  const { ws, transport } = fixture();
  try {
    const connecting = transport.connect("Batch", 0);
    ws.open();
    ws.message({
      type: "welcome",
      data: { id: "me", room: "arena", obstacles: [], protocol: PROTOCOL },
    });
    await connecting;
    for (let n = 0; n < 61; n++) transport.step({ x: 1 });
    const batches = ws.sent.filter((p) => p.type === "input-batch");
    assert.equal(batches.length, 31);
    assert.equal(batches.flatMap((p) => p.data).length, 61);
    assert.ok(batches.every((p) => p.data.length <= 2));
    transport.step({ x: 1, charge: true });
    assert.equal(ws.sent.at(-1).data.at(-1).charge, true);
    transport.step({ x: 1, charge: false });
    assert.equal(ws.sent.at(-1).data.at(-1).charge, false);
    transport.step({ x: 0 });
    assert.equal(ws.sent.at(-1).data.at(-1).x, 0);
  } finally {
    transport.close();
  }
});
test("quick matchmaking connects with a reserved seat and decodes binary snapshots", async () => {
  let requested;
  const f = fixture({
    matchmake: true,
    fetcher: async (url) => {
      requested = url.href;
      return Response.json({ room: "wildbow-2", ticket: "seat-token" });
    },
  });
  try {
    const connecting = f.transport.connect("Quick", 0);
    await new Promise((r) => setTimeout(r, 0));
    f.ws.open();
    f.ws.message({
      type: "welcome",
      data: { id: "me", room: "wildbow-2", obstacles: [], protocol: PROTOCOL },
    });
    await connecting;
    assert.equal(requested, "https://game.example/api/matchmake");
    assert.equal(
      f.address(),
      "wss://game.example/api/rooms/wildbow-2?ticket=seat-token",
    );
    const encoder = new SnapshotEncoder();
    f.ws.dispatchEvent(
      new MessageEvent("message", {
        data: encoder.encode({
          time: 1,
          players: [],
          arrows: [],
          orbs: [],
          powerups: [],
          events: [],
          roster: [],
        }),
      }),
    );
    assert.equal(f.transport.snapshots.at(-1).state.time, 1);
  } finally {
    f.transport.close();
  }
});
test("full rooms and early disconnects reject without leaving the join timer alive", async () => {
  for (const type of ["full", "close"]) {
    const { ws, transport } = fixture();
    const connecting = transport.connect("Archer", 0);
    if (type === "full") ws.message({ type: "full" });
    else ws.close();
    await assert.rejects(
      connecting,
      type === "full" ? /Arena dolu/ : /bağlantıyı kapattı/,
    );
    assert.equal(transport.closed, true);
  }
});
test("connection timeout returns to a retryable state and closes the socket", async () => {
  const { ws, transport } = fixture({ connectTimeout: 20 });
  await assert.rejects(transport.connect("Archer", 0), /Arenaya bağlanılamadı/);
  assert.equal(ws.readyState, 3);
});
test("only unexpected post-welcome closures notify the game, once", async () => {
  const f = fixture();
  const connecting = f.transport.connect("Archer", 0);
  welcome(f.ws);
  await connecting;
  f.ws.close();
  f.ws.close();
  assert.equal(f.disconnected(), 1);
  const own = fixture();
  const ownConnecting = own.transport.connect("Archer", 0);
  welcome(own.ws);
  await ownConnecting;
  own.transport.close();
  assert.equal(own.disconnected(), 0);
});
test("invalid rooms never open a connection", async () => {
  const { transport, address } = fixture({ room: "../escape" });
  await assert.rejects(transport.connect("Archer", 0), /Oda kodu/);
  assert.equal(address(), undefined);
});
test("cancelling a pending allocation settles connect immediately and late responses cannot open a socket", async () => {
  let allocation;
  const f = fixture({
    matchmake: true,
    fetcher: () =>
      new Promise((resolve) => {
        allocation = resolve;
      }),
  });
  const connecting = f.transport.connect("Cancel", 0);
  f.transport.close();
  await assert.rejects(connecting, /Bağlantı durduruldu/);
  allocation(Response.json({ room: "wildbow-3", ticket: "late-seat" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.address(), undefined);
});
test("progress reports allocation, socket opening and player handshake without caching a seat", async () => {
  const progress = [];
  let cache;
  const f = fixture({
    matchmake: true,
    onProgress: (stage) => progress.push(stage),
    fetcher: async (_url, options) => {
      cache = options.cache;
      return Response.json({ room: "wildbow-1", ticket: "seat" });
    },
  });
  try {
    const connecting = f.transport.connect("Stages", 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    welcome(f.ws);
    await connecting;
    assert.deepEqual(progress, ["matchmaking", "connecting", "joining"]);
    assert.equal(cache, "no-store");
  } finally {
    f.transport.close();
  }
});
test("timeouts and interrupted public seats are retryable; private capacity and identity errors are not", async () => {
  const cases = [
    { options: { connectTimeout: 10 }, event: null, retry: true },
    {
      options: {
        matchmake: true,
        fetcher: async () =>
          Response.json({ room: "wildbow-1", ticket: "seat" }),
      },
      event: "full",
      retry: true,
    },
    { options: {}, event: "full", retry: false },
    { options: {}, event: "error", retry: false },
  ];
  for (const { options, event, retry } of cases) {
    const f = fixture(options);
    const connecting = f.transport.connect("Retry", 0);
    const rejected = assert.rejects(
      connecting,
      (error) => error.retryable === retry,
    );
    if (event) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      f.ws.message({ type: event, data: { message: "Identity required" } });
    }
    await rejected;
  }
});
test("malformed welcome fails visibly instead of clearing the only connection deadline", async () => {
  const f = fixture();
  const connecting = f.transport.connect("Bad welcome", 0);
  f.ws.message({ type: "welcome" });
  await assert.rejects(connecting, /geçerli bir oyuncu yanıtı/);
  assert.equal(f.transport.closed, true);
});
