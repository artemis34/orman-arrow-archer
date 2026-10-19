import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketTransport } from "../client/websocket.js";
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
    this.sent.push(JSON.parse(data));
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
      data: { name: "Archer", skin: 2 },
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
