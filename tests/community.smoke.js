import assert from "node:assert/strict";
import { WebSocketTransport } from "../client/websocket.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, message, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await wait(60);
  }
  throw new Error(message);
}
const token = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
const keys = [token(), token()],
  clients = [];
const profile = async (key) =>
  (
    await (
      await fetch(`${base}/api/profile`, {
        headers: { Authorization: `Bearer ${key}` },
      })
    ).json()
  ).profile;
async function join(key) {
  const t = new WebSocketTransport(
    base,
    (s) => (t.latest = s),
    () => {},
    { format: "br", matchmake: true },
  );
  clients.push(t);
  await t.connect("Ranked Test", 0, { profileToken: key });
  return t;
}
try {
  const a = await join(keys[0]);
  await assert.rejects(() => join(keys[0]), /farklı online profil/);
  const b = await join(keys[1]);
  await until(
    () => a.latest?.match?.phase === "playing" && a.latest.roster.length === 32,
    "ranked match did not start",
    20000,
  );
  assert.equal(a.room, b.room);
  assert.equal(a.latest.roster.filter((p) => p.bot).length, 30);
  assert.equal(a.latest.players[0].level, 1);
  assert.ok(a.latest.orbs.length > 0);
  assert.equal((await profile(keys[0])).ratings.solo.points, 0);
  assert.equal((await profile(keys[1])).ratings.solo.points, 0);
  a.close();
  await until(
    async () => (await profile(keys[0])).ratings.solo.matches === 1,
    "departed BR player must receive a verified loss",
  );
  assert.equal((await profile(keys[0])).ratings.solo.points, 0);
  assert.equal((await profile(keys[0])).ratings.duo.matches, 0);
  assert.equal((await profile(keys[1])).ratings.solo.matches, 0);
  const board = await (await fetch(`${base}/api/leaderboard?kind=solo`)).json();
  const loser = await profile(keys[0]);
  assert.equal(board.kind, "solo");
  assert.ok(
    board.entries.every(
      (p) =>
        p.points === p.ratings.solo.points &&
        p.rankedMatches === p.ratings.solo.matches,
    ),
  );
  const duo = await (await fetch(`${base}/api/leaderboard?kind=duo`)).json();
  assert.ok(!duo.entries.some((p) => p.code === loser.socialCode));
  const publicData = JSON.stringify(board);
  assert.ok(!publicData.includes(keys[0]) && !publicData.includes(keys[1]));
  console.log(
    "COMMUNITY_RUNTIME_OK ranked distinct identity, authenticated matchmaking, 32 seats, isolated BR ratings, persistent leaderboards and private recovery keys",
  );
} finally {
  for (const t of clients) t.close();
}
