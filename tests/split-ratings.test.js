import test from "node:test";
import assert from "node:assert/strict";
import { platform } from "./helpers/community.js";
import { award, newProfile, profileId } from "../shared/profile.js";
import { ensureRatings } from "../shared/ranking.js";
import worker, { ArenaRoom } from "../cloudflare/worker.js";
import { World } from "../shared/world.js";
import { createMode, FORMATS, formatKey } from "../shared/modes.js";
test("only BR formats are always ranked and legacy links share canonical queues", () => {
  for (const [key, rules] of Object.entries(FORMATS))
    assert.equal(!!rules.ranked, !!rules.battleRoyale, key);
  assert.equal(formatKey("ranked"), "duel");
  assert.equal(formatKey("brranked"), "br");
  assert.equal(formatKey("brduoranked"), "brduo");
});
test("solo and duo points/matches/wins cannot affect one another or replay across queues", () => {
  const p = newProfile();
  p.ranked.points = 500;
  award(p, {
    receipt: "solo-win",
    ranked: true,
    rankMode: "solo",
    outcome: "win",
    win: true,
  });
  assert.deepEqual(p.ratings.solo, { points: 25, matches: 1, wins: 1 });
  assert.deepEqual(p.ratings.duo, { points: 0, matches: 0, wins: 0 });
  award(p, {
    receipt: "duo-draw",
    ranked: true,
    rankMode: "duo",
    outcome: "draw",
  });
  assert.deepEqual(p.ratings.duo, { points: 5, matches: 1, wins: 0 });
  award(p, {
    receipt: "solo-win",
    ranked: true,
    rankMode: "duo",
    outcome: "win",
  });
  assert.equal(p.ratings.duo.points, 5);
  assert.equal(p.ranked.points, 500);
});
test("legacy aggregate ratings are preserved without guessing their mode", () => {
  const old = {
    ranked: { points: 777, matches: 31, wins: 8 },
    coins: 123,
    owned: ["bow-oak"],
  };
  ensureRatings(old);
  assert.equal(old.ranked.points, 777);
  assert.equal(old.coins, 123);
  assert.equal(old.ratings.solo.points, 0);
  assert.equal(old.ratings.duo.points, 0);
  old.ratings.solo.points = 25;
  ensureRatings(old);
  assert.equal(old.ratings.solo.points, 25);
});
test("private profile migration persists and global leaderboards are independent", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const tokens = ["d".repeat(64), "e".repeat(64)],
    ids = await Promise.all(tokens.map(profileId));
  for (const id of ids) {
    const r = p.env.PROFILES.get(id);
    await r.fetch(new Request("https://profile/"));
  }
  const legacy = structuredClone(
    p.env.PROFILES.get(ids[0]).ctx.data.get("profile"),
  );
  legacy.ranked.points = 600;
  delete legacy.ratings;
  p.env.PROFILES.get(ids[0]).ctx.data.set("profile", legacy);
  for (const [i, rankMode] of ["solo", "duo"].entries())
    await p.env.PROFILES.get(ids[i]).fetch(
      new Request("https://profile/award", {
        method: "POST",
        body: JSON.stringify({
          receipt: "result" + i,
          ranked: true,
          rankMode,
          outcome: "win",
          win: true,
        }),
      }),
    );
  for (const [i, kind] of ["solo", "duo"].entries()) {
    const board = await (
      await worker.fetch(
        new Request("https://game/api/leaderboard?kind=" + kind),
        p.env,
      )
    ).json();
    assert.equal(board.entries.length, 1);
    assert.equal(board.entries[0].points, 25);
    const profile = (
      await (
        await p.env.PROFILES.get(ids[i]).fetch(new Request("https://profile/"))
      ).json()
    ).profile;
    assert.equal(board.entries[0].code, profile.socialCode);
  }
  const migrated = (
    await (
      await p.env.PROFILES.get(ids[0]).fetch(new Request("https://profile/"))
    ).json()
  ).profile;
  assert.equal(migrated.ranked.points, 600);
  assert.equal(migrated.ratings.solo.matches, 1);
  assert.equal(migrated.ratings.duo.matches, 0);
});
test("the authority stamps the correct rating mode for solo and duo wins", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const ids = await Promise.all(
    ["a".repeat(64), "b".repeat(64)].map(profileId),
  );
  for (const key of ["br", "brduo"]) {
    const room = new ArenaRoom(p.context(), p.env);
    room.world = new World({ bots: 0, mode: createMode(key) });
    room.world.mode.countdown = 0;
    for (let i = 0; i < 2; i++) {
      room.world.addPlayer("p" + i);
      room.sessions.set(
        { send() {} },
        {
          id: "p" + i,
          joined: true,
          joinedAt: 0,
          profileId: ids[i],
          activity: { kills: 0, hits: 0, assists: 0, objectives: 0 },
        },
      );
    }
    room.world.step();
    room.world.time = 60;
    room.world.gain = () => {};
    room.rankedParticipants = new Map([
      ["p0", ids[0]],
      ["p1", ids[1]],
    ]);
    room.rankedSides = new Map([
      ["p0", 0],
      ["p1", 1],
    ]);
    const dead = room.world.players.get("p1");
    dead.spawnShield = dead.levelGuard = 0;
    room.world.damage(dead, 9999, "p0");
    room.world.mode.finish(room.world);
    room.rewardRound();
    await p.drain();
    const profile = (
      await (
        await p.env.PROFILES.get(ids[0]).fetch(new Request("https://profile/"))
      ).json()
    ).profile;
    assert.equal(profile.ratings.solo.points, 25);
    assert.equal(profile.ratings.duo.points, key === "br" ? 0 : 25);
  }
});
