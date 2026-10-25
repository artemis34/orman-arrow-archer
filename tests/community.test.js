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
        rankMode: "solo",
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
test("legacy ranked-duel links now join casual duels and never qualify for RP", () => {
  const room = new ArenaRoom({ getWebSockets: () => [] }, {});
  room.world = new World({ bots: 0, mode: createMode("ranked") });
  room.world.addPlayer("a");
  room.world.addPlayer("b");
  room.world.step();
  room.rankedParticipants = new Map([
    ["a", "one"],
    ["b", "two"],
  ]);
  assert.equal(room.world.mode.id, "duel");
  assert.equal(room.world.mode.rules.ranked, undefined);
  assert.equal(room.rankedEligible({ id: "a", profileId: "one" }), false);
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

test("global presence counts real sessions across rooms, expires leases and rejects public spoofing", async (t) => {
  const p = platform();
  t.after(() => p.close());
  for (const [room, count] of [
    ["br:a", 3],
    ["arena:b", 2],
  ])
    await community(p.env, "/presence", { room, count, instance: "current" });
  assert.equal(
    (await (await call(p.env, "/api/presence", tokenA)).json()).online,
    5,
  );
  await community(p.env, "/presence", {
    room: "br:a",
    count: 0,
    instance: "old",
  });
  assert.equal((await (await community(p.env, "/presence")).json()).online, 5);
  await community(p.env, "/presence", {
    room: "br:a",
    count: 0,
    instance: "current",
  });
  assert.equal((await (await community(p.env, "/presence")).json()).online, 2);
  assert.equal(
    (await call(p.env, "/api/presence", tokenA, { room: "fake", count: 32 }))
      .status,
    405,
  );
  p.hubContext.storage.sql.exec("UPDATE presence SET expires=0");
  assert.equal((await (await community(p.env, "/presence")).json()).online, 0);
});

test("ranked BR awards verified results with opposing humans but a lone human cannot farm bot RP", async (t) => {
  const p = platform();
  t.after(() => p.close());
  for (const count of [1, 2]) {
    const room = new ArenaRoom(p.context(), p.env);
    room.world = new World({ bots: 0, mode: createMode("brranked") });
    room.world.mode.countdown = 0;
    const ids = [await profileId(tokenA), await profileId(tokenB)];
    for (let i = 0; i < count; i++) {
      room.world.addPlayer("human" + i);
      room.sessions.set(
        { send() {} },
        {
          id: "human" + i,
          profileId: ids[i],
          joined: true,
          joinedAt: 0,
          activity: { kills: 0, hits: 0, assists: 0, objectives: 0 },
        },
      );
    }
    room.world.addPlayer("bot", "Bot", 0, true);
    room.world.step();
    room.world.gain = () => {};
    room.world.time = 60;
    room.rankedParticipants = new Map(
      [...room.sessions.values()].map((s) => [s.id, s.profileId]),
    );
    for (const player of room.world.players.values())
      if (player.id !== "human0") {
        player.spawnShield = player.levelGuard = 0;
        room.world.damage(player, 9999, "human0");
      }
    room.world.mode.finish(room.world);
    room.rewardRound();
    await p.drain();
    const a = (await (await call(p.env, "/api/profile", tokenA)).json())
      .profile;
    assert.equal(a.ratings.solo.matches, count === 1 ? 0 : 1);
    assert.equal(a.ratings.solo.points, count === 1 ? 0 : 25);
  }
});

test("leaving ranked BR records one loss without terminating the other players match", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const room = new ArenaRoom(p.context(), p.env);
  room.world = new World({ bots: 0, mode: createMode("brranked") });
  room.world.mode.countdown = 0;
  const ids = [await profileId(tokenA), await profileId(tokenB)],
    sockets = [{ send() {} }, { send() {} }];
  sockets.forEach((ws, i) => {
    room.world.addPlayer("p" + i);
    room.sessions.set(ws, {
      id: "p" + i,
      joined: true,
      joinedAt: 0,
      profileId: ids[i],
      activity: { kills: 0, hits: 0, assists: 0, objectives: 0 },
    });
  });
  room.world.addPlayer("bot", "Bot", 0, true);
  room.world.step();
  room.rankedParticipants = new Map([
    ["p0", ids[0]],
    ["p1", ids[1]],
  ]);
  room.world.time = 20;
  room.remove(sockets[0]);
  await p.drain();
  assert.equal(room.world.mode.phase, "playing");
  const a = (await (await call(p.env, "/api/profile", tokenA)).json()).profile;
  assert.equal(a.ratings.solo.matches, 1);
  room.remove(sockets[0]);
  await p.drain();
  assert.equal(
    (await (await call(p.env, "/api/profile", tokenA)).json()).profile.ratings
      .solo.matches,
    1,
  );
});

test("simultaneous final deaths in ranked BR award draws instead of losses", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const room = new ArenaRoom(p.context(), p.env);
  room.world = new World({ bots: 0, mode: createMode("brranked") });
  room.world.mode.countdown = 0;
  const ids = [await profileId(tokenA), await profileId(tokenB)];
  for (let i = 0; i < 2; i++) {
    room.world.addPlayer("p" + i);
    room.sessions.set(
      { send() {} },
      {
        id: "p" + i,
        profileId: ids[i],
        joined: true,
        joinedAt: 0,
        activity: { kills: 0, hits: 0, assists: 0, objectives: 0 },
      },
    );
  }
  room.world.step();
  room.world.time = 60;
  room.rankedParticipants = new Map([
    ["p0", ids[0]],
    ["p1", ids[1]],
  ]);
  for (const player of room.world.players.values()) {
    player.spawnShield = player.levelGuard = 0;
    room.world.damage(player, 9999, null, "storm");
  }
  room.world.mode.finish(room.world);
  room.rewardRound();
  await p.drain();
  for (const token of [tokenA, tokenB]) {
    const profile = (await (await call(p.env, "/api/profile", token)).json())
      .profile;
    assert.equal(profile.ratings.solo.matches, 1);
    assert.equal(profile.ratings.solo.points, 5);
    assert.equal(profile.ratings.solo.wins, 0);
  }
});
