import test from "node:test";
import assert from "node:assert/strict";
import { platform } from "./helpers/community.js";
import worker, { ArenaRoom } from "../cloudflare/worker.js";
import { profileId, newProfile } from "../shared/profile.js";
import { community, canonicalProfile } from "../cloudflare/community.js";
import { CommunityHub } from "../cloudflare/community.js";
import { createMode } from "../shared/modes.js";
import { World } from "../shared/world.js";
import { PlayerProfile } from "../cloudflare/profile.js";
const tokenA = "a".repeat(64),
  tokenB = "b".repeat(64),
  tokenC = "c".repeat(64);
const call = (env, path, token, data) =>
  worker.fetch(
    new Request(`https://game${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { method: "POST", body: JSON.stringify(data) } : {}),
    }),
    env,
  );
test("friend requests require reciprocal consent, survive restart, and cannot impersonate a caller", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const a = (await (await call(p.env, "/api/profile", tokenA)).json()).profile,
    b = (await (await call(p.env, "/api/profile", tokenB)).json()).profile;
  assert.equal(
    (
      await call(p.env, "/api/profile/friends/request", tokenA, {
        target: b.socialCode,
        code: b.socialCode,
      })
    ).status,
    200,
  );
  let friends = await (
    await call(p.env, "/api/profile/friends", tokenB)
  ).json();
  assert.equal(friends.friends.length, 0);
  assert.equal(friends.incoming[0].code, a.socialCode);
  assert.equal(
    (
      await call(p.env, "/api/profile/friends/accept", tokenA, {
        target: b.socialCode,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(p.env, "/api/profile/friends/accept", tokenB, {
        target: a.socialCode,
      })
    ).status,
    200,
  );
  const restarted = new CommunityHub(p.hubContext);
  p.env.COMMUNITY.get = () => restarted;
  friends = await (await call(p.env, "/api/profile/friends", tokenA)).json();
  assert.equal(friends.friends[0].code, b.socialCode);
  assert.ok(!JSON.stringify(friends).includes(await profileId(tokenB)));
  assert.ok(!JSON.stringify(friends).includes(tokenB));
  await call(p.env, "/api/profile/friends/remove", tokenB, {
    target: a.socialCode,
  });
  assert.equal(
    (await (await call(p.env, "/api/profile/friends", tokenA)).json()).friends
      .length,
    0,
  );
  assert.equal((await call(p.env, "/api/profile/friends", "bad")).status, 401);
});
test("global ranks use server receipts; public clients cannot write scores, aliases or activity", async (t) => {
  const p = platform();
  t.after(() => p.close());
  await call(p.env, "/api/profile", tokenA);
  const id = await profileId(tokenA),
    object = p.env.PROFILES.get(id);
  await object.fetch(
    new Request("https://profile/award", {
      method: "POST",
      body: JSON.stringify({
        receipt: "r1",
        ranked: true,
        outcome: "win",
        win: true,
        kills: 5,
      }),
    }),
  );
  const board = await (
    await worker.fetch(new Request("https://game/api/leaderboard"), p.env)
  ).json();
  assert.equal(board.entries[0].points, 25);
  assert.equal(board.entries[0].rank.name, "Tohum");
  for (const path of [
    "/api/profile/activity",
    "/api/profile/award",
    "/api/community/upsert",
    "/api/community/link",
  ])
    assert.equal(
      (await call(p.env, path, tokenA, { points: 99999, ranked: true })).status,
      405,
    );
  assert.equal(
    (
      await (
        await worker.fetch(
          new Request("https://game/api/leaderboard?kind=kills"),
          p.env,
        )
      ).json()
    ).entries[0].kills,
    5,
  );
});
test("ranked forfeit and results award once to distinct real profiles, never from bot fills", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const ctx = p.context(),
    room = new ArenaRoom(ctx, p.env);
  const results = [];
  room.world = new World({ bots: 0, mode: createMode("ranked") });
  room.world.addPlayer("a");
  room.world.addPlayer("b");
  room.world.step();
  const ids = [await profileId(tokenA), await profileId(tokenB)];
  const sockets = [
    { send: (s) => results.push(JSON.parse(s)) },
    { send: (s) => results.push(JSON.parse(s)) },
  ];
  sockets.forEach((ws, i) =>
    room.sessions.set(ws, {
      id: i ? "b" : "a",
      profileId: ids[i],
      joined: true,
      joinedAt: 0,
      room: "ranked-wildbow-1",
      activity: { kills: 0, hits: 0, assists: 0, objectives: 0 },
    }),
  );
  room.rankedStartedAt = 0;
  room.rankedParticipants = new Map([
    ["a", ids[0]],
    ["b", ids[1]],
  ]);
  room.world.time = 15;
  room.remove(sockets[0]);
  await p.drain();
  const a = (await (await call(p.env, "/api/profile", tokenA)).json()).profile,
    b = (await (await call(p.env, "/api/profile", tokenB)).json()).profile;
  assert.equal(a.ranked.matches, 1);
  assert.equal(a.ranked.points, 0);
  assert.equal(b.ranked.points, 25);
  room.rewardRound();
  await p.drain();
  assert.equal(
    (await (await call(p.env, "/api/profile", tokenB)).json()).profile.ranked
      .points,
    25,
  );
  assert.equal(room.world.players.size, 1);
  assert.equal([...room.world.players.values()].filter((p) => p.bot).length, 0);
});
test("provider setup is optional and no credential or fake login is exposed", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const config = await (
    await worker.fetch(new Request("https://game/api/auth/providers"), p.env)
  ).json();
  assert.deepEqual(config.providers, {
    google: { configured: false },
    apple: { configured: false },
  });
  assert.equal(
    (await call(p.env, "/api/auth/google/start", tokenA, {})).status,
    503,
  );
  assert.equal(
    (await call(p.env, "/api/auth/apple/start", tokenA, {})).status,
    503,
  );
});
test("existing guest profiles migrate once without losing cosmetics, currency or lifetime titles", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const ctx = p.context(),
    old = newProfile();
  delete old.socialCode;
  delete old.ranked;
  delete old.displayName;
  old.coins = 91;
  old.stats.kills = 50;
  await ctx.storage.put("profile", old);
  let profile = new PlayerProfile(ctx, p.env);
  const read = async () =>
    (await (await profile.fetch(new Request("https://profile/"))).json())
      .profile;
  const first = await read();
  profile = new PlayerProfile(ctx, p.env);
  const second = await read();
  assert.equal(first.socialCode, second.socialCode);
  assert.equal(second.coins, 91);
  assert.equal(second.stats.kills, 50);
  assert.equal(second.ranked.points, 0);
  assert.deepEqual(second.owned, old.owned);
});
test("a lost stats acknowledgement retries the same receipt instead of counting an elimination twice", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const original = p.env.PROFILES,
    receipts = [];
  let lost = false;
  p.env.PROFILES = {
    ...original,
    get: (id) => ({
      fetch: async (request) => {
        const payload = await request.clone().json();
        receipts.push(payload.receipt);
        const response = await original.get(id).fetch(request);
        if (!lost) {
          lost = true;
          throw new Error("lost acknowledgement after successful storage");
        }
        return response;
      },
    }),
  };
  const room = new ArenaRoom(p.context(), p.env),
    id = await profileId(tokenA),
    s = {
      id: "p",
      profileId: id,
      activity: { kills: 2, hits: 3, assists: 0, objectives: 0 },
    };
  await room.flushActivity({ send: () => {} }, s);
  await p.drain();
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0], receipts[1]);
  const profile = (
    await (await original.get(id).fetch(new Request("https://profile/"))).json()
  ).profile;
  assert.equal(profile.stats.kills, 2);
  assert.equal(profile.stats.hits, 3);
  assert.equal(s.pendingActivity, null);
});
