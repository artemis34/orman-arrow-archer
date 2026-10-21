import test from "node:test";
import assert from "node:assert/strict";
import { encodePacket, decodePacket } from "../shared/protocol.js";

test("UTF-8 reuse retains Unicode, FIFO eviction and ownership of previously sent packets", () => {
  const value = ["Çağrı 🏹", "\ud800", "", "長".repeat(129)];
  const first = encodePacket(value),
    bytes = Buffer.from(first).toString("hex");
  for (let i = 0; i < 1024; i++) encodePacket([`new-${i} 🏹`]);
  assert.equal(Buffer.from(encodePacket(value)).toString("hex"), bytes);
  new Uint8Array(first).fill(0);
  assert.equal(
    Buffer.from(encodePacket(value)).toString("hex"),
    bytes,
    "mutating an output cannot corrupt cached bytes",
  );
  assert.deepEqual(decodePacket(encodePacket(value)), [
    "Çağrı 🏹",
    "�",
    "",
    "長".repeat(129),
  ]);
});
test("short-string cache is bounded and excludes long messages", (context) => {
  const original = Map.prototype.set,
    caches = new Set();
  context.mock.method(Map.prototype, "set", function (key, value) {
    if (typeof key === "string" && value instanceof Uint8Array)
      caches.add(this);
    return original.call(this, key, value);
  });
  for (let i = 0; i < 4096; i++)
    encodePacket([`short-${i}`, `long-${i}-` + "x".repeat(256)]);
  assert.ok(caches.size > 0);
  for (const cache of caches) {
    assert.ok(cache.size <= 256);
    assert.ok([...cache.keys()].every((key) => key.length <= 128));
  }
});
