import test from "node:test";
import assert from "node:assert/strict";
import worker, { ArenaRoom } from "../cloudflare/worker.js";
import { connectionProbe } from "../cloudflare/connection-probe.js";
import { summarize, diagnose, probeSocket } from "../public/connection-test.js";

test("connection metadata is uncached, uses provider geography, and omits account identifiers", async () => {
  const request = new Request("https://game/api/connection-info?region=wnam", {
    headers: { Origin: "https://game", Authorization: "Bearer private" },
  });
  Object.defineProperty(request, "cf", {
    value: { country: "TR", colo: "IST", continent: "AS" },
  });
  const response = await worker.fetch(request, {});
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    version: 1,
    country: "TR",
    ingress: "IST",
    region: "eeur",
    alternateRegion: "weur",
    regionalMatchmaking: true,
  });
  const fallback = await worker.fetch(
    new Request("https://game/api/connection-info"),
    { REGIONAL_MATCHMAKING: "off" },
  );
  assert.deepEqual(await fallback.json(), {
    version: 1,
    country: "",
    ingress: "",
    region: "",
    alternateRegion: "",
    regionalMatchmaking: false,
  });
});

test("probes route to the actual room or a bounded regional diagnostic object without reserving seats", async () => {
  const calls = [];
  const env = {
    ARENAS: {
      idFromName: (n) => n,
      get: (id, options) => ({
        fetch: async (r) => {
          calls.push({ id, options, path: new URL(r.url).pathname });
          return Response.json({ ok: true });
        },
      }),
    },
  };
  const request = (
    query,
    origin = "https://game",
    cf = { country: "TR", continent: "AS" },
  ) => {
    const r = new Request(`https://game/api/connection-probe?${query}`, {
      headers: { Upgrade: "websocket", Origin: origin },
    });
    Object.defineProperty(r, "cf", {
      value: cf,
    });
    return r;
  };
  await worker.fetch(request("target=regional"), env);
  await worker.fetch(request("target=alternate&region=wnam"), env);
  await worker.fetch(request("target=room&room=brduo-wildbow-wnam-1"), env);
  await worker.fetch(request("target=room&room=wildbow-1"), env);
  assert.deepEqual(calls, [
    {
      id: "network-probe:eeur",
      options: { locationHint: "eeur" },
      path: "/connection-probe",
    },
    {
      id: "network-probe:weur",
      options: { locationHint: "weur" },
      path: "/connection-probe",
    },
    {
      id: "brduo-wildbow-wnam-1",
      options: { locationHint: "wnam" },
      path: "/connection-probe",
    },
    { id: "wildbow-1", options: undefined, path: "/connection-probe" },
  ]);
  for (const query of [
    "target=unknown",
    "target=room&room=../bad",
    "target=room&room=BAD",
  ])
    assert.equal((await worker.fetch(request(query), env)).status, 400);
  assert.equal(
    (await worker.fetch(request("target=regional", "https://evil"), env))
      .status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request("https://game/api/connection-probe?target=edge"),
        env,
      )
    ).status,
    426,
  );
  assert.equal(
    (
      await worker.fetch(
        request("target=alternate", "https://game", {
          continent: "NA",
          longitude: "-118",
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 4);
});

test("a room echo never starts, joins, mutates or advances a game; probes close and are bounded", async (t) => {
  const descriptors = new Map(
    ["WebSocketPair", "Response"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const servers = [];
  class Socket {
    listeners = new Map();
    sent = [];
    accepted = false;
    closed = null;
    addEventListener(key, fn) {
      this.listeners.set(key, fn);
    }
    fire(key, data) {
      this.listeners.get(key)?.(data);
    }
    accept() {
      this.accepted = true;
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close(code) {
      this.closed = code;
      this.fire("close");
    }
  }
  Object.defineProperty(globalThis, "WebSocketPair", {
    configurable: true,
    value: class {
      constructor() {
        const server = new Socket();
        servers.push(server);
        return { 0: {}, 1: server };
      }
    },
  });
  t.mock.method(globalThis, "Response", function (_body, init) {
    return init;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    for (const [key, value] of descriptors) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  const room = new ArenaRoom({ getWebSockets: () => [] });
  room.format = "brduo";
  const state = { unchanged: true };
  room.world = state;
  room.sessions.set("player", { joined: true });
  room.reservations.set("ticket", 1);
  const response = await room.fetch(
    new Request("https://internal/connection-probe", {
      headers: { Upgrade: "websocket" },
    }),
  );
  const server = servers[0];
  assert.equal(response.status, 101);
  assert.equal(server.accepted, true);
  assert.deepEqual(server.sent, [
    { type: "ready", context: { humans: 1, ticking: false, format: "brduo" } },
  ]);
  server.fire("message", { data: JSON.stringify({ type: "probe", id: 3 }) });
  assert.deepEqual(server.sent.at(-1), { type: "probe", id: 3 });
  assert.equal(room.world, state);
  assert.equal(room.format, "brduo");
  assert.equal(room.sessions.size, 1);
  assert.equal(room.reservations.size, 1);
  assert.equal(room.timer, undefined);
  t.mock.timers.tick(25000);
  assert.equal(server.closed, 1000);
  connectionProbe(
    new Request("https://internal/connection-probe", {
      headers: { Upgrade: "websocket" },
    }),
  );
  for (let i = 0; i < 25; i++) servers[1].fire("message", { data: "{}" });
  assert.equal(servers[1].closed, 1008);
  connectionProbe(
    new Request("https://internal/connection-probe", {
      headers: { Upgrade: "websocket" },
    }),
  );
  servers[2].fire("close");
  assert.equal(
    servers[2].closed,
    1000,
    "a client close is acknowledged instead of leaving a half-open probe",
  );
  const edge = new Request("https://game/api/connection-probe?target=edge", {
    headers: { Upgrade: "websocket" },
  });
  Object.defineProperty(edge, "cf", { value: { country: "TR", colo: "IST" } });
  await worker.fetch(edge, {});
  assert.deepEqual(servers[3].sent[0], {
    type: "ready",
    route: { kind: "edge", country: "TR", ingress: "IST", region: "eeur" },
  });
  assert.ok(
    !("context" in servers[3].sent[0]),
    "legacy diagnostic clients must not mistake edge geography for a game context",
  );
});

test("connection comparison requires enough samples and distinguishes observed paths without claiming a city", () => {
  assert.deepEqual(summarize([30, 10, NaN, 20, Infinity]), {
    count: 3,
    median: 20,
    p95: 30,
    max: 30,
  });
  assert.equal(summarize([]).median, null);
  assert.equal(summarize([10, 20, 30, 40]).median, 25);
  const r = (target, median, p95 = median) => ({
    target,
    median,
    p95,
    count: 20,
  });
  assert.match(
    diagnose([r("edge", 20), r("regional", 20), r("room", 180)]),
    /Son oyun odasına/,
  );
  assert.match(
    diagnose([r("edge", 20), r("regional", 180)]),
    /oda arasında ek gecikme/,
  );
  assert.match(
    diagnose([r("edge", 180), r("regional", 180)]),
    /girişine ulaşırken de/,
  );
  assert.match(
    diagnose([r("edge", 20), r("regional", 25)]),
    /belirgin bir oda gecikmesi ayrışmadı/,
  );
  assert.match(
    diagnose([{ ...r("edge", 20), count: 1 }, r("regional", 180)]),
    /yeterli yanıt/,
  );
});

test("diagnosis cannot hide missing responses or latency spikes behind a low median", () => {
  const r = (target, median = 20, p95 = median, count = 20) => ({
    target,
    median,
    p95,
    count,
    expected: 20,
  });
  assert.match(
    diagnose([r("edge"), r("regional", 20, 20, 5)]),
    /Eksik veya yanıtsız/,
  );
  assert.match(
    diagnose([r("edge"), r("regional"), r("room", 20, 20, 19)]),
    /Eksik veya yanıtsız/,
  );
  assert.match(
    diagnose([r("edge"), r("regional", 25, 500)]),
    /Oda yolunda.*sıçramaları/,
  );
  assert.match(
    diagnose([r("edge"), r("regional"), r("room", 25, 500)]),
    /Son oyun odasında.*sıçramaları/,
  );
  assert.match(
    diagnose([r("edge", 25, 400), r("regional", 25, 400)]),
    /girişine ulaşırken de/,
  );
  assert.match(
    diagnose([r("edge"), r("regional", 180), r("alternate", 35)]),
    /Alternatif bölge/,
  );
  assert.match(
    diagnose([r("edge"), r("regional", 25, 500), r("alternate", 30, 40)]),
    /Alternatif bölge/,
  );
  assert.match(
    diagnose([r("edge"), r("regional", 180), r("alternate", 35, 35, 10)]),
    /Eksik veya yanıtsız/,
  );
});

test("late probe replies never become the next request's RTT and close clears outstanding timers", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  let socket,
    now = 0;
  class FakeSocket extends EventTarget {
    sent = [];
    constructor() {
      super();
      socket = this;
      queueMicrotask(() => this.reply({ type: "ready" }));
    }
    reply(data) {
      this.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(data) }),
      );
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.dispatchEvent(new Event("close"));
    }
  }
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeSocket,
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "WebSocket", descriptor);
    else delete globalThis.WebSocket;
  });
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const result = probeSocket("wss://game", { samples: 2, interval: 0 });
  await flush();
  assert.equal(socket.sent[0].id, 0);
  now = 2500;
  t.mock.timers.tick(2500);
  await flush();
  t.mock.timers.tick(0);
  await flush();
  assert.equal(socket.sent[1].id, 1);
  now = 2510;
  socket.reply({ type: "probe", id: 0 });
  now = 2520;
  socket.reply({ type: "probe", id: 1 });
  await flush();
  t.mock.timers.tick(0);
  const actual = await result;
  assert.equal(actual.count, 1);
  assert.equal(actual.median, 20);
  assert.equal(actual.timeouts, 1);
});
