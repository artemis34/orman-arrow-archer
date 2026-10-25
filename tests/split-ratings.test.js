import test from "node:test";
import assert from "node:assert/strict";
import { platform } from "./helpers/community.js";
import { award, newProfile, profileId } from "../shared/profile.js";
import {
  ensureRatings,
  placementDelta,
  ratingScaleFor,
} from "../shared/ranking.js";
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

test("placement RP has exact solo and team cutoffs, decreases with place and never rounds to zero", () => {
  for (const [kind, cutoff, total] of [
    ["solo", 10, 32],
    ["duo", 8, 16],
  ]) {
    for (const scale of [1, ratingScaleFor(1, 32), 0.5]) {
      let previous = Infinity;
      for (let place = 1; place <= total; place++) {
        const delta = placementDelta(kind, place, scale);
        assert.ok(
          place <= cutoff ? delta > 0 : delta < 0,
          `${kind} ${place}: ${delta}`,
        );
        assert.ok(delta <= previous);
        previous = delta;
      }
    }
    assert.equal(placementDelta(kind, 1), 25);
    assert.equal(placementDelta(kind, cutoff), 2);
    assert.equal(placementDelta(kind, cutoff + 1), -1);
    assert.equal(placementDelta(kind, total), -10);
    assert.equal(placementDelta(kind, 0), null);
    assert.equal(placementDelta(kind, total + 1), null);
  }
  const p = newProfile();
  p.ratings.solo.points = 100;
  award(p, {
    receipt: "eleventh",
    ranked: true,
    rankMode: "solo",
    placement: 11,
    outcome: "loss",
  });
  assert.equal(p.ratings.solo.points, 99);
  award(p, {
    receipt: "tenth",
    ranked: true,
    rankMode: "solo",
    placement: 10,
    outcome: "loss",
  });
  assert.equal(p.ratings.solo.points, 101);
  assert.equal(p.ratings.solo.wins, 0, "top-ten RP is not a victory");
  p.ratings.duo.points = 1;
  award(p, {
    receipt: "last-duo",
    ranked: true,
    rankMode: "duo",
    placement: 16,
    outcome: "loss",
  });
  assert.equal(p.ratings.duo.points, 0);
  assert.equal(p.ratings.solo.points, 101);
});

test("the server remembers elimination places across departures and both teammates share the team placement", () => {
  for (const key of ["br", "brduo"]) {
    const w = new World({ bots: 0, mode: createMode(key) });
    w.mode.countdown = 0;
    for (let i = 0; i < 32; i++) {
      const p = w.addPlayer("p" + i);
      if (key === "brduo") p.team = Math.floor(i / 2);
    }
    w.step();
    w.gain = () => {};
    for (const p of w.players.values()) p.spawnShield = p.levelGuard = 0;
    const first = w.players.get("p0"),
      mate = w.players.get("p1");
    w.damage(first, 9999, "p31");
    if (key === "brduo") {
      assert.equal(
        w.mode.teamPlacements.has(0),
        false,
        "one teammate death still allows revival",
      );
      w.damage(mate, 9999, "p31");
      assert.equal(w.mode.placementFor(w, mate), 16);
    }
    const expected = key === "br" ? 32 : 16;
    assert.equal(w.mode.placementFor(w, first), expected);
    for (let i = 2; i < 12; i++) w.damage(w.players.get("p" + i), 9999, "p31");
    assert.equal(
      w.mode.placementFor(w, first),
      expected,
      "waiting cannot improve an eliminated rank",
    );
    w.removePlayer("p2");
    w.removePlayer("p12");
    for (let i = 13; i < 30; i++) w.damage(w.players.get("p" + i), 9999, "p31");
    if (key === "br") {
      w.damage(mate, 9999, "p31");
      w.damage(w.players.get("p30"), 9999, "p31");
    }
    w.mode.finish(w);
    assert.equal(
      w.mode.results.find((p) => p.id === first.id).placement,
      expected,
    );
    if (key === "brduo")
      assert.equal(
        w.mode.results.find((p) => p.id === mate.id).placement,
        expected,
      );
    assert.equal(w.mode.results[0].placement, 1);
    assert.equal(
      w.mode.results.find((p) => p.id === "p3").placement,
      key === "br" ? 30 : 15,
    );
  }
});

test("profile awards use authoritative final placements for positive and negative team results", async () => {
  for (const key of ["br", "brduo"]) {
    const tasks = [],
      awards = [];
    const room = new ArenaRoom(
      { getWebSockets: () => [], waitUntil: (task) => tasks.push(task) },
      {
        PROFILES: {
          idFromName: (id) => id,
          get: (id) => ({
            fetch: async (request) => {
              awards.push({ id, ...(await request.json()) });
              return Response.json({ profile: {} });
            },
          }),
        },
      },
    );
    room.world = new World({ bots: 0, mode: createMode(key) });
    room.world.mode.countdown = 0;
    room.flushActivity = async () => {};
    for (let i = 0; i < 32; i++) {
      const p = room.world.addPlayer("p" + i);
      if (key === "brduo") p.team = Math.floor(i / 2);
      if (i < 2 || i === 31)
        room.sessions.set(
          { send() {} },
          { id: p.id, joined: true, profileId: p.id },
        );
    }
    room.rankedParticipants = new Map(
      [...room.sessions.values()].map((s) => [s.id, s.profileId]),
    );
    room.rankedScale = 1;
    room.world.step();
    room.world.gain = () => {};
    for (const p of room.world.players.values())
      p.spawnShield = p.levelGuard = 0;
    for (let i = 0; i < (key === "br" ? 31 : 30); i++)
      room.world.damage(room.world.players.get("p" + i), 9999, "p31");
    room.world.mode.finish(room.world);
    room.rewardRound();
    await Promise.all(tasks);
    for (const a of awards) {
      assert.equal(a.rankMode, key === "br" ? "solo" : "duo");
      assert.equal(
        a.placement,
        room.world.mode.results.find((row) => row.id === a.id).placement,
      );
      assert.ok(
        a.id === "p31"
          ? placementDelta(a.rankMode, a.placement) > 0
          : placementDelta(a.rankMode, a.placement) < 0,
      );
    }
    assert.equal(awards.length, 3);
    if (key === "brduo") assert.equal(awards[0].placement, awards[1].placement);
    room.rewardRound();
    assert.equal(awards.length, 3, "the same round is not awarded twice");
  }
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

test("RP scales with the opening human/bot mix for both gains and losses", async () => {
  const { ratingScaleFor, ratingDelta } = await import("../shared/ranking.js");
  for (const [humans, win, loss, draw] of [
    [1, 5, -2, 1],
    [16, 13, -5, 3],
    [32, 25, -10, 5],
  ]) {
    const scale = ratingScaleFor(humans, 32);
    assert.equal(ratingDelta("win", scale), win);
    assert.equal(ratingDelta("loss", scale), loss);
    assert.equal(ratingDelta("draw", scale), draw);
  }
  const p = newProfile();
  award(p, {
    receipt: "bot-solo",
    ranked: true,
    rankMode: "solo",
    ratingScale: ratingScaleFor(1, 32),
    outcome: "win",
    win: true,
  });
  assert.equal(p.ratings.solo.points, 5);
  assert.equal(p.ratings.duo.points, 0);
});

test("the authority freezes bot weighting at round start even if the roster later changes", () => {
  for (const key of ["br", "brduo"]) {
    const room = new ArenaRoom({ getWebSockets: () => [], waitUntil() {} }, {});
    room.world = new World({ bots: 0, mode: createMode(key) });
    room.world.mode.countdown = 0;
    room.world.setBotCount(31);
    room.world.addPlayer("human");
    room.sessions.set(
      { send() {} },
      {
        id: "human",
        joined: true,
        profileId: "verified",
        lastInput: Date.now(),
        inputs: [],
      },
    );
    room.step();
    assert.equal(room.rankedScale, 0.2);
    assert.equal(room.rankedEligible([...room.sessions.values()][0]), true);
    for (let i = 0; i < 15; i++) room.world.removePlayer("bot-" + i);
    room.step();
    assert.equal(room.rankedScale, 0.2);
  }
});
