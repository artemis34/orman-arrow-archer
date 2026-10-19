import assert from "node:assert/strict";
import { WebSocketTransport } from "../client/websocket.js";
import { RULES, advanceMovement, cleanInput } from "../shared/config.js";
import { annotateFailure } from "./report.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const room = `test-${Date.now().toString(36)}`;
const clients = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await wait(30);
  }
  throw new Error(`Timed out: ${description}`);
}
async function join(name, code = room) {
  const received = [];
  const t = new WebSocketTransport(
    base,
    (state) => {
      t.latest = state;
      received.push(...state.events);
    },
    () => {},
    { room: code },
  );
  clients.push(t);
  await t.connect(name, 0);
  await until(() => t.latest, "initial snapshot");
  return { t, received, me: () => t.latest.players.find((p) => p.id === t.id) };
}
const status = async (code = room) =>
  (await fetch(`${base}/api/rooms/${code}/status`)).json();
try {
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.tickRate, 30);
  assert.equal(health.snapshotRate, 15);
  assert.equal(health.transport, "websocket");
  assert.equal((await fetch(`${base}/api/rooms/x/status`)).status, 400);
  assert.equal(
    (
      await fetch(`${base}/api/rooms/${room}/status`, {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  const a = await join("Cloud A"),
    b = await join("Cloud B"),
    c = await join("Other room", `${room}-other`);
  a.t.step({ charge: true });
  b.t.step({ charge: true });
  c.t.step({ charge: true });
  await until(
    () =>
      a.t.latest.players.some((p) => p.id === b.t.id) &&
      b.t.latest.players.some((p) => p.id === a.t.id),
    "two humans share authority",
  );
  assert.ok(!a.t.latest.players.some((p) => p.id === c.t.id));
  assert.ok(!c.t.latest.players.some((p) => p.id === a.t.id));
  assert.equal(a.t.latest.powerups.length, 2);
  assert.ok(a.t.latest.orbs.some((orb) => orb.rare));
  const before = { ...a.me() };
  a.t.ws.send("{");
  a.t.ws.send("null");
  a.t.send("input", {
    x: 0,
    z: 0,
    charge: true,
    seq: ++a.t.seq,
    hp: 999,
    damage: 999,
    position: { x: 999, z: 999 },
    buffType: "power",
    buffTime: 999,
  });
  await until(
    () => a.me().seq === a.t.seq,
    "authoritative input acknowledgement",
  );
  assert.equal(a.me().x, before.x);
  assert.equal(a.me().z, before.z);
  assert.equal(a.me().hp, RULES.playerHealth);
  assert.equal(a.me().buffTime, 0);
  a.t.choose("hacked");
  // Choose clear ground rather than depending on a particular random safe spawn.
  let direction,
    best = -1;
  for (let i = 0; i < 16; i++) {
    const input = cleanInput({
      x: Math.cos((i * Math.PI) / 8),
      z: Math.sin((i * Math.PI) / 8),
      angle: (i * Math.PI) / 8,
      charge: true,
    });
    const predicted = structuredClone(a.me());
    for (let n = 0; n < 15; n++)
      advanceMovement(predicted, input, 1 / RULES.tick, a.t.obstacles);
    const distance = Math.hypot(predicted.x - before.x, predicted.z - before.z);
    if (distance > best) {
      best = distance;
      direction = input;
    }
  }
  const holding = setInterval(() => {
    a.t.step(direction);
    b.t.step({ charge: true });
  }, 1000 / RULES.tick);
  try {
    await until(
      () =>
        Math.hypot(a.me().x - before.x, a.me().z - before.z) > 1 &&
        a.me().charge > 0.2,
      "movement and draw on real workerd",
    );
  } finally {
    clearInterval(holding);
  }
  a.t.step({ charge: false });
  await until(
    () =>
      a.received.some(
        (event) => event.type === "shot" && event.owner === a.t.id,
      ),
    "shot event survives 30Hz to 15Hz snapshot batching",
  );
  assert.equal(a.me().upgrades.hacked, undefined);
  a.t.step({ charge: true });
  await until(() => a.me().charge > 0.08, "draw starts");
  await wait(550);
  assert.equal(a.me().charge, 0, "stale connections cannot retain a drawn bow");
  a.t.close();
  b.t.step({ charge: true });
  await until(
    () => !b.t.latest.players.some((p) => p.id === a.t.id),
    "disconnect removes actor",
  );
  b.t.close();
  c.t.close();
  for (let i = 0; i < 60 && (await status()).ticking; i++) await wait(30);
  assert.deepEqual(await status(), {
    ok: true,
    humans: 0,
    ticking: false,
    time: 0,
  });
  await wait(150);
  assert.equal(
    (await status()).time,
    0,
    "bots stop after the last person leaves",
  );
  const oversized = await join("Oversized", `${room}-bad`);
  let closeCode;
  oversized.t.ws.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  oversized.t.ws.send("x".repeat(5000));
  await until(() => closeCode !== undefined, "oversized frame closes");
  assert.equal(closeCode, 1009);
  const capacity = `${room}-cap`;
  for (let i = 0; i < 16; i++) await join(`P${i}`, capacity);
  await assert.rejects(join("Overflow", capacity), /Arena dolu/);
  assert.equal((await status(capacity)).humans, 16);
  console.log(
    "CLOUDFLARE_OK: real workerd/Durable Objects, two-player shared arena, room isolation, 30Hz authority/15Hz snapshots, shot events, forged input rejection, stale-input reset, 16-human capacity, payload/origin limits and empty-room shutdown.",
  );
} catch (error) {
  annotateFailure(error, "Cloudflare authoritative multiplayer");
  throw error;
} finally {
  for (const client of clients) client.close();
}
