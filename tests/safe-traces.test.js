import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { traces } from "../benchmarks/conformance.js";
const expected = JSON.parse(
  readFileSync(
    new URL("./fixtures/onehand-flow-traces-2026-10-23.json", import.meta.url),
  ),
);
test("authority, JSON, v2 bytes and presentation retain reviewed one-hand release traces", async () => {
  const actual = await traces(new URL("..", import.meta.url).pathname, {
    legacyRoster: true,
  });
  assert.deepEqual(actual, {
    scenarios: expected.scenarios,
    clientViews: expected.clientViews,
  });
  // This release intentionally changes selection protection, public pickup
  // placements/bot goals and remote-player presentation. Historical fixtures
  // remain untouched; protocol-conformance keeps production bytes/flags exact.
  for (const result of actual.scenarios) {
    assert.ok(result.hits > 100);
    assert.ok(result.kills > 0);
    assert.ok(result.shots > 200);
  }
});
