import test from "node:test";
import assert from "node:assert/strict";
import worker, { ArenaRoom, ArenaMatchmaker } from "../cloudflare/worker.js";
import {
  requestRegion,
  roomRegion,
  publicRoom,
  REGIONS,
} from "../cloudflare/regions.js";
import { FORMATS } from "../shared/modes.js";
import { roomCode } from "../shared/online.js";
test("provider geography picks nearby pools and never consumes user-supplied region parameters", async () => {
  for (const [cf, region] of [
    [{ country: "TR", continent: "AS" }, "eeur"],
    [{ country: "FR", continent: "EU" }, "weur"],
    [{ continent: "NA", longitude: "-118" }, "wnam"],
    [{ continent: "NA", longitude: "-74" }, "enam"],
    [{ continent: "AS" }, "apac"],
    [null, ""],
  ])
    assert.equal(requestRegion(cf), region);
  const calls = [];
  const env = {
    MATCHMAKER: {
      idFromName: (n) => n,
      get: (id, options) => ({
        fetch: async (r) => {
          calls.push({ id, options, url: r.url });
          return Response.json({ room: "test" });
        },
      }),
    },
  };
  const req = new Request(
    "https://game/api/matchmake?format=brduo&region=wnam",
  );
  Object.defineProperty(req, "cf", {
    value: { country: "TR", continent: "AS" },
  });
  await worker.fetch(req, env);
  assert.equal(calls[0].id, "public:brduo:eeur");
  assert.deepEqual(calls[0].options, { locationHint: "eeur" });
  assert.match(calls[0].url, /region=eeur/);
  await worker.fetch(req, { ...env, REGIONAL_MATCHMAKING: "off" });
  assert.equal(calls[1].id, "public:brduo");
  assert.equal(calls[1].options, undefined);
});
test("legacy invites keep their IDs and regional invites keep their placement across countries", async () => {
  const calls = [];
  const env = {
    ARENAS: {
      idFromName: (n) => n,
      get: (id, options) => ({
        fetch: async () => {
          calls.push({ id, options });
          return Response.json({ ok: true });
        },
      }),
    },
  };
  for (const code of ["friends-123", "brduo-wildbow-1", "brduo-wildbow-eeur-1"])
    await worker.fetch(
      new Request(`https://game/api/rooms/${code}/status`),
      env,
    );
  assert.deepEqual(calls, [
    { id: "friends-123", options: undefined },
    { id: "brduo-wildbow-1", options: undefined },
    { id: "brduo-wildbow-eeur-1", options: { locationHint: "eeur" } },
  ]);
  for (const format of Object.keys(FORMATS))
    for (const region of REGIONS) {
      const code = `${format === "arena" ? "" : format + "-"}wildbow-${region}-128`;
      assert.equal(roomCode(code), code);
      assert.equal(roomRegion(code), region);
      assert.equal(publicRoom(code), true);
    }
});
test("regional directories fill seats, spill, recycle, and keep regions independent", async () => {
  const rooms = new Map(),
    hints = [];
  const env = {
    ARENAS: {
      idFromName: (n) => n,
      get: (name, opts) => {
        hints.push(opts?.locationHint);
        if (!rooms.has(name))
          rooms.set(name, new ArenaRoom({ getWebSockets: () => [] }));
        return rooms.get(name);
      },
    },
  };
  const directory = async () => {
    let loaded;
    const data = new Map();
    const d = new ArenaMatchmaker(
      {
        storage: {
          get: async (k) => data.get(k),
          put: async (k, v) => data.set(k, v),
        },
        blockConcurrencyWhile: (fn) => (loaded = fn()),
      },
      env,
    );
    await loaded;
    return d;
  };
  const east = await directory(),
    west = await directory();
  try {
    const allocations = [];
    for (let i = 0; i < 33; i++)
      allocations.push(
        await (
          await east.fetch(
            new Request("https://internal/find?format=brduo&region=eeur"),
          )
        ).json(),
      );
    assert.equal(
      allocations.filter((x) => x.room === "brduo-wildbow-eeur-1").length,
      32,
    );
    assert.equal(allocations[32].room, "brduo-wildbow-eeur-2");
    assert.equal(
      (
        await (
          await west.fetch(
            new Request("https://internal/find?format=brduo&region=weur"),
          )
        ).json()
      ).room,
      "brduo-wildbow-weur-1",
    );
    const room = rooms.get(allocations[0].room);
    clearTimeout(room.reservations.get(allocations[0].ticket));
    room.reservations.delete(allocations[0].ticket);
    await east.fetch(
      new Request("https://internal/available?format=brduo&region=eeur", {
        method: "POST",
        body: JSON.stringify({ room: allocations[0].room }),
      }),
    );
    assert.equal(
      (
        await (
          await east.fetch(
            new Request("https://internal/find?format=brduo&region=eeur"),
          )
        ).json()
      ).room,
      allocations[0].room,
    );
    assert.ok(hints.every((h) => ["eeur", "weur"].includes(h)));
  } finally {
    for (const r of rooms.values())
      for (const timer of r.reservations.values()) clearTimeout(timer);
  }
});
test("regional public humans are opponents, while private friends remain paired", () => {
  for (const code of [
    "duos-wildbow-eeur-1",
    "duos-wildbow-1",
    "friends-test",
  ]) {
    const r = new ArenaRoom({ getWebSockets: () => [], waitUntil() {} }, {});
    r.format = "duos";
    const sockets = [{ send() {} }, { send() {} }];
    try {
      for (const [i, ws] of sockets.entries()) {
        r.sessions.set(ws, {
          id: "p" + i,
          room: code,
          joined: false,
          budget: 90,
          refill: Date.now(),
          lastInput: Date.now(),
        });
        r.webSocketMessage(
          ws,
          JSON.stringify({ type: "join", data: { name: "Human" + i } }),
        );
      }
      const [a, b] = [...r.world.players.values()].filter((p) => !p.bot);
      assert.equal(a.team === b.team, code === "friends-test");
    } finally {
      for (const ws of sockets) r.remove(ws);
    }
  }
});
