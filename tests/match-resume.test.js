import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RoundMode, createMode } from "../shared/modes.js";
import { NetworkTransport } from "../client/transport.js";
import { ArenaRoom } from "../cloudflare/worker.js";
import { newProfile } from "../shared/profile.js";
test("malformed format objects fall back safely without invoking attacker-controlled coercion", () => {
  assert.equal(createMode({ toString: 0, valueOf: 0 }).id, "arena");
  assert.equal(createMode("__proto__").id, "arena");
});
test("rematch discards old predicted inputs and preserves the authoritative new spawn", () => {
  const w = new World({ bots: 0, mode: new RoundMode("round") });
  const p = w.addPlayer("me");
  w.addPlayer("other");
  w.step();
  const t = new NetworkTransport(
    () => {},
    () => {},
  );
  t.id = "me";
  t.obstacles = [];
  t.send = () => {};
  t.acceptState(w.snapshot(p.id));
  t.step({ x: 1 });
  assert.equal(t.pending.length, 1);
  w.mode.phase = "results";
  t.acceptState(w.snapshot(p.id));
  t.step({ x: 1 });
  w.mode.round++;
  w.mode.phase = "playing";
  p.x = 30;
  p.z = -30;
  t.acceptState(w.snapshot(p.id));
  assert.equal(t.pending.length, 0);
  assert.equal(t.localPose().x, p.x);
  assert.equal(t.localPose().z, p.z);
});
test("a duel returns to waiting if the opponent leaves, without playing a bot or awarding a solo win", () => {
  const w = new World({ bots: 0, mode: createMode("duel") });
  w.addPlayer("a");
  w.addPlayer("b");
  w.step();
  assert.equal(w.mode.phase, "playing");
  w.removePlayer("b");
  w.step();
  assert.equal(w.mode.phase, "waiting");
  assert.equal(w.mode.results, null);
  assert.equal(w.players.size, 1);
});
test("round rewards use authoritative stats, unique receipts and a participation threshold", async () => {
  const tasks = [],
    receipts = [];
  const room = new ArenaRoom(
    { getWebSockets: () => [], waitUntil: (task) => tasks.push(task) },
    {
      PROFILES: {
        idFromName: (id) => id,
        get: () => ({
          fetch: async (request) => {
            receipts.push(await request.json());
            return Response.json({ profile: newProfile() });
          },
        }),
      },
    },
  );
  room.world = new World({ bots: 0, mode: createMode("round") });
  room.world.addPlayer("a");
  room.world.addPlayer("late");
  room.world.step();
  room.world.time = 100;
  room.world.players.get("a").kills = 4;
  room.sessions.set(
    { send() {} },
    { id: "a", profileId: "profile-a", joinedAt: 0 },
  );
  room.sessions.set(
    { send() {} },
    { id: "late", profileId: "profile-late", joinedAt: 95 },
  );
  room.world.mode.finish(room.world);
  room.rewardRound();
  room.rewardRound();
  await Promise.all(tasks);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].kills, 4);
  assert.match(receipts[0].receipt, /:1$/);
});
