import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { platform } from "./helpers/community.js";
import { authFetch } from "../cloudflare/auth.js";
import { profileId } from "../shared/profile.js";
import { canonicalProfile } from "../cloudflare/community.js";
test("Google foundation uses state, PKCE, nonce and verified issuer/audience; linking is replay safe and keeps the original profile", async (t) => {
  const p = platform();
  t.after(() => p.close());
  const { privateKey, publicKey } = await generateKeyPair("RS256"),
    jwk = await exportJWK(publicKey);
  jwk.kid = "test-google";
  Object.assign(p.env, {
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
  });
  const guest = "a".repeat(64),
    other = "b".repeat(64),
    id = await profileId(guest);
  let activeNonce,
    wrongNonce = false,
    exchanges = 0;
  t.mock.method(globalThis, "fetch", async (address, init) => {
    if (String(address).includes("googleapis.com/oauth2/v3/certs"))
      return Response.json({ keys: [jwk] });
    if (String(address) === "https://oauth2.googleapis.com/token") {
      exchanges++;
      const params = new URLSearchParams(init.body);
      assert.ok(params.get("code_verifier").length >= 43);
      assert.equal(params.get("client_secret"), "test-secret");
      const token = await new SignJWT({
        nonce: wrongNonce ? "bad" : activeNonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setSubject("google-user-1")
        .setIssuer("https://accounts.google.com")
        .setAudience("test-client")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return Response.json({ id_token: token });
    }
    throw new Error(`Unexpected external request ${address}`);
  });
  const start = async (token) => {
    const r = await authFetch(
      new Request("https://game/api/auth/google/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
      p.env,
    );
    assert.equal(r.status, 200);
    const { url } = await r.json(),
      u = new URL(url);
    activeNonce = u.searchParams.get("nonce");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(!url.includes(token) && !url.includes("test-secret"));
    return {
      state: u.searchParams.get("state"),
      cookie: r.headers.get("Set-Cookie").split(";")[0],
    };
  };
  let flow = await start(guest);
  const callback = (flow, cookie = flow.cookie) =>
    authFetch(
      new Request(
        `https://game/api/auth/google/callback?state=${flow.state}&code=one-time-code`,
        { headers: { Cookie: cookie } },
      ),
      p.env,
    );
  assert.match(
    (await callback(flow, "wildbow_oauth=wrong")).headers.get("Location"),
    /auth=error/,
  );
  assert.equal(exchanges, 0);
  assert.match(
    (await callback(flow)).headers.get("Location"),
    /auth=connected/,
  );
  assert.equal(exchanges, 1);
  assert.match((await callback(flow)).headers.get("Location"), /auth=error/);
  assert.equal(exchanges, 1);
  flow = await start(other);
  assert.match(
    (await callback(flow)).headers.get("Location"),
    /auth=connected/,
  );
  assert.equal(await canonicalProfile(p.env, await profileId(other)), id);
  const linked = await (
    await p.env.PROFILES.get(id).fetch(new Request("https://profile/"))
  ).json();
  assert.deepEqual(linked.profile.accounts, ["google"]);
  const third = "c".repeat(64);
  flow = await start(third);
  wrongNonce = true;
  assert.match((await callback(flow)).headers.get("Location"), /auth=error/);
  assert.equal(
    await canonicalProfile(p.env, await profileId(third)),
    await profileId(third),
  );
});
