import assert from "node:assert/strict";
import { WebSocketTransport } from "../client/websocket.js";
import { FORMATS } from "../shared/modes.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await wait(40);
  }
  throw new Error(message);
}
const clients = [];
async function connect(format, room, name, options = {}) {
  const t = new WebSocketTransport(
    base,
    (state) => (t.latest = state),
    () => {},
    { format, room },
  );
  clients.push(t);
  await t.connect(name, 0, options);
  await until(() => t.latest, "initial snapshot");
  return t;
}
try {
  for (const [format, rules] of Object.entries(FORMATS)) {
    if (format === "arena") continue;
    const room = `mode-${format}-${Date.now().toString(36)}`;
    const group = [];
    for (let i = 0; i < rules.capacity; i++)
      group.push(await connect(format, room, `P${i}`));
    const first = group[0];
    await until(
      () => first.latest.roster.filter((p) => !p.bot).length === rules.capacity,
      "all participants share one authority",
    );
    assert.equal(first.latest.match.format, format);
    assert.equal(first.latest.match.phase, "playing");
    assert.equal(first.latest.roster.length, rules.capacity);
    if (rules.teams)
      for (let team = 0; team < rules.teams; team++)
        assert.equal(
          first.latest.roster.filter((p) => p.team === team).length,
          rules.capacity / rules.teams,
        );
    await assert.rejects(() => connect(format, room, "Overflow"), /dolu/);
    const status = await (
      await fetch(`${base}/api/rooms/${room}/status`)
    ).json();
    assert.equal(status.capacity, rules.capacity);
    assert.equal(status.format, format);
    const me = first.latest.players.find((p) => p.id === first.id);
    first.step({ x: 1, seq: 1 });
    first.step({ x: 1, seq: 2 });
    await until(
      () => first.latest.players.find((p) => p.id === first.id).seq >= 1,
      "binary movement in selected format",
    );
    if (rules.duel) {
      assert.equal(first.latest.roster.filter((p) => p.bot).length, 0);
      assert.equal(first.latest.orbs.length, 0);
    }
    assert.ok(me);
    for (const t of group) t.close();
    await wait(120);
    assert.equal(
      (await (await fetch(`${base}/api/rooms/${room}/status`)).json()).ticking,
      false,
    );
    console.log(
      `MODE_OK ${format} ${rules.capacity} humans ${rules.teams} teams`,
    );
  }
  const key = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const profile = await (
    await fetch(`${base}/api/profile`, { headers })
  ).json();
  assert.equal(profile.profile.coins, 0);
  const buy = await fetch(`${base}/api/profile/purchase`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: "bow-moon" }),
  });
  assert.equal(buy.status, 400);
  const forged = await connect(
    "arena",
    `profile-${Date.now().toString(36)}`,
    "Profile",
    { profileToken: key, cosmetics: { bow: "bow-moon" } },
  );
  assert.equal(
    forged.latest.players.find((p) => p.id === forged.id).cosmetics.bow,
    "bow-oak",
  );
  assert.equal(
    (
      await fetch(`${base}/api/profile/award`, {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    405,
  );
  console.log(
    "PROFILE_API_OK private identity, ownership validation and server-only awards",
  );
  const allocation = await (
    await fetch(`${base}/api/matchmake?format=t2`)
  ).json();
  assert.match(allocation.room, /^t2-wildbow-/);
  console.log("MULTIMODE_CLOUDFLARE_OK");
} finally {
  for (const t of clients) t.close();
}
