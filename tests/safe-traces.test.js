import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { traces } from "../benchmarks/conformance.js";
const expected = JSON.parse(
  readFileSync(new URL("./fixtures/safe-traces-7397e49.json", import.meta.url)),
);
test("unchanged authority, JSON, v2 bytes, input edges and presentation match live 7397e49 traces", async () => {
  const actual = await traces(new URL("..", import.meta.url).pathname);
  assert.deepEqual(actual, {
    scenarios: expected.scenarios,
    clientViews: expected.clientViews,
  });
  for (const result of actual.scenarios) {
    assert.ok(result.hits > 100);
    assert.ok(result.kills > 0);
    assert.ok(result.shots > 200);
  }
});
