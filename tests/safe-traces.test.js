import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { traces } from "../benchmarks/conformance.js";
const expected = JSON.parse(
  readFileSync(
    new URL("./fixtures/motion-traces-2026-10-21.json", import.meta.url),
  ),
);
const optimizationBaseline = JSON.parse(
  readFileSync(new URL("./fixtures/safe-traces-7397e49.json", import.meta.url)),
);
test("authority, JSON, v2 bytes and presentation retain reviewed motion regression traces", async () => {
  const actual = await traces(new URL("..", import.meta.url).pathname);
  assert.deepEqual(actual, {
    scenarios: expected.scenarios,
    clientViews: expected.clientViews,
  });
  // Only bot steering and arrow presentation are intentionally different from
  // the optimization baseline. Human-only physics and wire traces stay exact.
  for (const id of ["arena-8", "team-16"])
    assert.deepEqual(
      actual.scenarios.find((scenario) => scenario.id === id),
      optimizationBaseline.scenarios.find((scenario) => scenario.id === id),
    );
  for (const result of actual.scenarios) {
    assert.ok(result.hits > 100);
    assert.ok(result.kills > 0);
    assert.ok(result.shots > 200);
  }
});
