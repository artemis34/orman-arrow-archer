import test from "node:test";
import assert from "node:assert/strict";
import {
  newProfile,
  award,
  purchase,
  equip,
  publicProfile,
  profileId,
  sanitizeCosmetics,
} from "../shared/profile.js";
import { PlayerProfile } from "../cloudflare/profile.js";
import worker from "../cloudflare/worker.js";
test("cosmetics require ownership and earned currency; forged equipment cannot change stats", () => {
  const p = newProfile();
  assert.ok(purchase(p, "bow-moon").error);
  assert.ok(equip(p, "bow-moon").error);
  assert.ok(equip(p, "damage+100").error);
  for (let i = 0; i < 3; i++)
    award(p, { receipt: String(i), kills: 5, hits: 10, points: 15, win: true });
  assert.ok(p.owned.includes("cape-moon"));
  assert.ok(p.owned.includes("bow-moon"));
  const before = p.coins;
  assert.ok(purchase(p, "trail-spark").ok);
  assert.equal(p.coins, before - 100);
  assert.ok(purchase(p, "trail-spark").ok);
  assert.equal(p.coins, before - 100);
  assert.ok(equip(p, "trail-spark").ok);
  assert.equal(sanitizeCosmetics(p).trail, "trail-spark");
  assert.equal(sanitizeCosmetics(null, { bow: "bow-moon" }).bow, "bow-oak");
  assert.ok(!("receipts" in publicProfile(p)));
});
test("authoritative match receipts award once and untrusted requests cannot reach the award endpoint", async () => {
  const p = newProfile();
  award(p, { receipt: "round-1", kills: 1 });
  const coins = p.coins;
  assert.equal(award(p, { receipt: "round-1", kills: 999 }), false);
  assert.equal(p.coins, coins);
  assert.equal(
    (
      await worker.fetch(
        new Request("https://game/api/profile/award", { method: "POST" }),
        {},
      )
    ).status,
    405,
  );
  assert.equal(
    (await worker.fetch(new Request("https://game/api/profile"), {})).status,
    401,
  );
  assert.equal(await profileId("hacked"), null);
});
test("profile storage persists across object restart and duplicate award delivery", async () => {
  const storage = new Map();
  const ctx = {
    storage: {
      get: async (k) => structuredClone(storage.get(k)),
      put: async (k, v) => storage.set(k, structuredClone(v)),
    },
    blockConcurrencyWhile: (fn) => fn(),
  };
  let object = new PlayerProfile(ctx);
  const call = async (path, data) =>
    (
      await object.fetch(
        new Request(
          `https://profile${path}`,
          data ? { method: "POST", body: JSON.stringify(data) } : {},
        ),
      )
    ).json();
  await call("/award", { receipt: "room:1", kills: 10, win: true });
  const first = await call("/");
  object = new PlayerProfile(ctx);
  assert.deepEqual((await call("/")).profile, first.profile);
  await call("/award", { receipt: "room:1", kills: 10, win: true });
  assert.deepEqual((await call("/")).profile, first.profile);
  const equipped = await call("/equip", { id: "bow-moon" });
  assert.ok(equipped.error);
});
