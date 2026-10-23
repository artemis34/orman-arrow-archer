import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { createMode } from "../shared/modes.js";
import { sendEmote, drainEmotes, EMOTE_RULES } from "../shared/emotes.js";
import { SnapshotEncoder, SnapshotDecoder } from "../shared/protocol.js";

test("reactions are fixed cosmetic events, survive stepping, and remain protocol-v2 compatible", () => {
  const world = new World({ bots: 0 });
  const player = world.addPlayer("one");
  const observer = world.addPlayer("two");
  const before = { hp: player.hp, xp: player.xp, shield: player.spawnShield };
  player.hidden = true;
  assert.equal(sendEmote(world, player.id, "heart"), true);
  assert.equal(player.hidden, false);
  assert.equal(player.revealUntil, world.time + EMOTE_RULES.duration);
  assert.deepEqual(
    { hp: player.hp, xp: player.xp, shield: player.spawnShield },
    before,
  );
  world.step();
  world.events.push(...drainEmotes(world));
  const events = new SnapshotDecoder().decode(
    new SnapshotEncoder().encode(world.snapshot(observer.id)),
  ).events;
  assert.deepEqual(
    events
      .filter((event) => event.type === "emote")
      .map((event) => ({ ...event })),
    [{ type: "emote", owner: player.id, key: "heart" }],
  );
  assert.deepEqual(drainEmotes(world), []);
});

test("authority rejects forged text, dead actors, spam, and non-playing rounds", () => {
  const world = new World({ bots: 0 });
  const player = world.addPlayer("one");
  for (const key of [
    "__proto__",
    "constructor",
    "<script>",
    {},
    null,
    ["wave"],
  ])
    assert.equal(sendEmote(world, player.id, key), false);
  assert.equal(sendEmote(world, "missing", "wave"), false);
  assert.equal(sendEmote(world, player.id, "wave"), true);
  assert.equal(sendEmote(world, player.id, "gg"), false);
  drainEmotes(world);
  world.time += EMOTE_RULES.cooldown;
  assert.equal(sendEmote(world, player.id, "gg"), true);
  player.alive = false;
  assert.deepEqual(drainEmotes(world), []);
  world.time += EMOTE_RULES.cooldown;
  assert.equal(sendEmote(world, player.id, "wave"), false);
  const duel = new World({ bots: 0, mode: createMode("duel") });
  const waiting = duel.addPlayer("waiting");
  assert.equal(sendEmote(duel, waiting.id, "wave"), false);
});

test("reaction queue is bounded and never broadcasts a departed player", () => {
  const world = new World({ bots: 0 });
  for (let i = 0; i < 16; i++) {
    world.addPlayer(String(i));
    assert.equal(sendEmote(world, String(i), "target"), true);
  }
  world.time += EMOTE_RULES.cooldown;
  for (let i = 0; i < 16; i++)
    assert.equal(
      sendEmote(world, String(i), "target"),
      i < EMOTE_RULES.maxPending - 16,
    );
  world.removePlayer("0");
  const events = drainEmotes(world);
  assert.equal(events.length, EMOTE_RULES.maxPending - 2);
  assert.ok(
    events.every((event) => event.owner !== "0" && !Object.hasOwn(event, "x")),
  );
});
