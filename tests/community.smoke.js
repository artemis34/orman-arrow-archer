import assert from "node:assert/strict";
import { WebSocketTransport } from "../client/websocket.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, message, timeout=6000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {
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
    { format: "ranked", matchmake: true },
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
    () => a.latest?.match?.phase === "playing" && a.latest.roster.length === 2,
    "ranked match did not start",
  );
  assert.equal(a.room, b.room);
  assert.equal(a.latest.roster.filter((p) => p.bot).length, 0);
  assert.equal(a.latest.players[0].level, 1);
  assert.equal(a.latest.orbs.length, 0);
  assert.equal((await profile(keys[0])).ranked.points, 0);
  assert.equal((await profile(keys[1])).ranked.points, 0);
  await until(()=>a.latest?.match?.remaining<=108,"ranked clock did not reach the disconnect grace threshold",30000);
  a.close();
  await until(
    async () => (await profile(keys[1])).ranked.points === 25,
    "forfeit was not scored by the authority",
  );
  assert.equal((await profile(keys[0])).ranked.points, 0);
  assert.equal((await profile(keys[0])).ranked.matches, 1);
  const board = await (await fetch(`${base}/api/leaderboard`)).json();
  const winner=await profile(keys[1]);
  assert.ok(board.entries.some((p) => p.code===winner.socialCode&&p.points===25));
  const publicData = JSON.stringify(board);
  assert.ok(!publicData.includes(keys[0]) && !publicData.includes(keys[1]));
  console.log(
    "COMMUNITY_RUNTIME_OK ranked distinct identity, authenticated matchmaking, equal starts, forfeit ratings, persistent leaderboards and private recovery keys",
  );
} finally {
  for (const t of clients) t.close();
}
