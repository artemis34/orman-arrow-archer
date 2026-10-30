import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
function fixture(offline = false) {
  const handlers = new Map(),
    writes = [],
    fetched = [];
  const cache = {
    put: async (key, response) =>
      writes.push({ key, body: await response.text() }),
  };
  runInNewContext(source, {
    URL,
    Response,
    self: {
      location: {
        href: "https://game.example/sub/sw.js",
        origin: "https://game.example",
      },
      addEventListener: (key, handler) => handlers.set(key, handler),
    },
    caches: {
      open: async () => cache,
      match: async () => new Response("cached game"),
    },
    fetch: async (request) => {
      fetched.push(request.url);
      if (offline) throw new Error("offline");
      return new Response("fresh " + new URL(request.url).pathname);
    },
  });
  const request = (path, mode = "navigate") => {
    let response;
    handlers.get("fetch")({
      request: { url: "https://game.example" + path, method: "GET", mode },
      respondWith: (value) => {
        response = value;
      },
    });
    return response;
  };
  return { request, writes, fetched };
}
test("diagnostic documents cannot replace the cached game, including subdirectory deployments", async () => {
  const f = fixture();
  assert.equal(
    await (await f.request("/sub/connection-test.html")).text(),
    "fresh /sub/connection-test.html",
  );
  assert.equal(f.writes.length, 0);
  await (await f.request("/sub/?room=friends-test")).text();
  assert.deepEqual(f.writes, [{ key: "./", body: "fresh /sub/" }]);
  await (await f.request("/sub/index.html")).text();
  assert.equal(f.writes.at(-1).body, "fresh /sub/index.html");
});
test("offline diagnostics explain the missing connection while the game keeps its own fallback", async () => {
  const f = fixture(true);
  assert.equal(await (await f.request("/sub/")).text(), "cached game");
  const diagnostic = await f.request("/sub/connection-test.html");
  assert.equal(diagnostic.status, 503);
  assert.match(await diagnostic.text(), /internet bağlantısı/);
  assert.equal(f.writes.length, 0);
});
test("unversioned helpers refresh online, hashed assets stay cached and private APIs stay outside the cache", async () => {
  const f = fixture();
  assert.equal(
    await (await f.request("/sub/connection-test.js?v=2", "cors")).text(),
    "fresh /sub/connection-test.js",
  );
  assert.equal(f.fetched.length, 1);
  assert.equal(
    await (await f.request("/sub/assets/index-hash.js", "cors")).text(),
    "cached game",
  );
  assert.equal(f.fetched.length, 1);
  assert.equal(f.request("/api/profile", "cors"), undefined);
  assert.equal(f.request("/health", "cors"), undefined);
  assert.ok(!f.writes.some((r) => String(r.key).includes("/api/")));
  const offline = fixture(true);
  assert.equal(
    await (await offline.request("/sub/connection-test.js?v=2", "cors")).text(),
    "cached game",
  );
});
