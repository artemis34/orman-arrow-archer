import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { traces } from "../benchmarks/conformance.js";
const expected = JSON.parse(
  readFileSync(
    new URL("./fixtures/forest-traces-2026-10-21.json", import.meta.url),
  ),
);
const presentationBaseline = JSON.parse(
  readFileSync(
    new URL("./fixtures/motion-traces-2026-10-21.json", import.meta.url),
  ),
);
test("authority, JSON, v2 bytes and presentation retain reviewed motion regression traces", async () => {
  const actual = await traces(new URL("..", import.meta.url).pathname, {
    legacyRoster: true,
  });
  assert.deepEqual(actual, {
    scenarios: expected.scenarios,
    clientViews: expected.clientViews,
  });
  // Critical hits and the new skill intentionally change combat. The reviewed
  // traces freeze those mechanics while retaining the prior arrow smoothing.
  assert.equal(actual.clientViews, presentationBaseline.clientViews);
  for (const result of actual.scenarios) {
    assert.ok(result.hits > 100);
    assert.ok(result.kills > 0);
    assert.ok(result.shots > 200);
  }
});
