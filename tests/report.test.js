import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("uncaught callback failures are annotated without swallowing their failing exit", () => {
  const report = new URL("./report.js", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(report)}); setTimeout(() => { throw new Error("callback failure fixture"); }, 0);`,
    ],
    {
      env: { ...process.env, GITHUB_ACTIONS: "true" },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /::error title=Uncaught runtime test failure::/);
  assert.match(child.stderr, /callback failure fixture/);
});
