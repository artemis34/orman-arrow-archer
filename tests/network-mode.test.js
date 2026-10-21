import test from "node:test";
import assert from "node:assert/strict";
import { usesCloudflare } from "../client/network-mode.js";
test("a Workers host uses native WebSocket even with a generic production build", () => {
  assert.equal(
    usesCloudflare(
      "production",
      null,
      "orman-arrow-archer.example.workers.dev",
    ),
    true,
  );
  assert.equal(
    usesCloudflare("production", null, "preview-worker.example.workers.dev"),
    true,
  );
});
test("Cloudflare custom domains and explicit static frontend adapters retain native WebSocket", () => {
  assert.equal(usesCloudflare("cloudflare", null, "game.example.com"), true);
  assert.equal(
    usesCloudflare("production", "websocket", "cdn.example.com"),
    true,
  );
});
test("ordinary Node hosts keep their Socket.IO adapter", () => {
  for (const host of [
    "127.0.0.1",
    "localhost",
    "game.onrender.com",
    "workers.dev.other.example",
  ])
    assert.equal(usesCloudflare("production", null, host), false);
});
