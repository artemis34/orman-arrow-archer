import assert from "node:assert/strict";
import { WebSocketTransport } from "../client/websocket.js";
import { annotateFailure } from "./report.js";
const base = process.env.CLOUDFLARE_TEST_URL || "http://127.0.0.1:8787";
const clients = [];
async function until(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
async function connect(options) {
  const t = new WebSocketTransport(
    base,
    (state) => {
      t.latest = state;
    },
    () => {},
    { format: "br", ...options },
  );
  clients.push(t);
  await t.connect("BR smoke", 0, {
    profileToken: [...crypto.getRandomValues(new Uint8Array(32))]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join(""),
  });
  await until(() => t.latest, "BR initial snapshot");
  return t;
}
try {
  const first = await connect({ matchmake: true });
  assert.equal(first.latest.match.format, "br");
  assert.equal(first.latest.match.capacity, 32);
  assert.ok(first.latest.roster.every((p) => p.team == null));
  await until(
    () => first.latest.match.phase === "playing",
    "BR countdown must start the match",
  );
  assert.ok(first.latest.match.zone.radius > 59);
  await assert.rejects(() => connect({ room: first.room }), /dolu/);
  const next = await connect({ matchmake: true });
  assert.notEqual(
    next.room,
    first.room,
    "quick join must avoid a BR round already in progress",
  );
  assert.equal(next.latest.match.phase, "waiting");
  const before = first.latest.players.find((p) => p.id === first.id).x;
  first.step({ x: 1, seq: 1 });
  first.step({ x: 1, seq: 2 });
  await until(
    () => first.latest.players.find((p) => p.id === first.id)?.seq >= 1,
    "BR authority processes movement",
  );
  assert.ok(first.latest.players.find((p) => p.id === first.id).x >= before);
  console.log(
    "BATTLE_ROYALE_RUNTIME_OK: native WebSocket, 32 solo seats, countdown, live zone metadata, movement, late-entry rejection and new-round matchmaking.",
  );
} catch (error) {
  annotateFailure(error, "Cloudflare Battle Royale runtime");
  throw error;
} finally {
  for (const t of clients) t.close();
}
