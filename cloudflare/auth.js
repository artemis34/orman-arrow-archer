import { createRemoteJWKSet, jwtVerify } from "jose";
import { profileId } from "../shared/profile.js";
import { canonicalProfile, community } from "./community.js";
const providers = {
  google: {
    id: "GOOGLE_CLIENT_ID",
    secret: "GOOGLE_CLIENT_SECRET",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
  },
  apple: {
    id: "APPLE_CLIENT_ID",
    secret: "APPLE_CLIENT_SECRET",
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    issuer: "https://appleid.apple.com",
    jwks: "https://appleid.apple.com/auth/keys",
  },
};
const keys = new Map();
const random = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
const cookie = (request, value, maxAge) =>
  `wildbow_oauth=${value}; Path=/; HttpOnly; ${new URL(request.url).protocol === "https:" ? "Secure; SameSite=None" : "SameSite=Lax"}; Max-Age=${maxAge}`;
export const authProviders = (env) =>
  Object.fromEntries(
    Object.entries(providers).map(([key, p]) => [
      key,
      { configured: !!(env[p.id] && env[p.secret] && env.COMMUNITY) },
    ]),
  );
export async function authFetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/providers")
    return Response.json(
      { providers: authProviders(env) },
      { headers: { "Cache-Control": "no-store" } },
    );
  const route = /^\/api\/auth\/(google|apple)\/(start|callback)$/.exec(
    url.pathname,
  );
  if (!route) return new Response("Not found", { status: 404 });
  const [, provider, action] = route,
    p = providers[provider];
  if (!authProviders(env)[provider].configured)
    return Response.json(
      { error: "Bu hesap bağlantısı henüz etkin değil." },
      { status: 503 },
    );
  const redirect = `${url.origin}/api/auth/${provider}/callback`;
  if (action === "start") {
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    const guestId = await profileId(
      request.headers.get("Authorization")?.replace(/^Bearer /, ""),
    );
    if (!guestId) return new Response("Invalid profile key", { status: 401 });
    const id = await canonicalProfile(env, guestId),
      state = random(),
      nonce = random(),
      verifier = random();
    const stored = await community(env, "/flow-create", {
      state,
      flow: {
        provider,
        profileId: id,
        guestId,
        nonce,
        verifier,
        expires: Date.now() + 600000,
      },
    });
    if (!stored.ok) return stored;
    const address = new URL(p.authorize);
    for (const [key, value] of Object.entries({
      client_id: env[p.id],
      redirect_uri: redirect,
      response_type: "code",
      scope: provider === "apple" ? "name email" : "openid profile email",
      state,
      nonce,
    }))
      address.searchParams.set(key, value);
    if (provider === "google") {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
      );
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
      address.searchParams.set("code_challenge", challenge);
      address.searchParams.set("code_challenge_method", "S256");
    } else address.searchParams.set("response_mode", "form_post");
    return Response.json(
      { url: address.href },
      {
        headers: {
          "Set-Cookie": cookie(request, state, 600),
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const finish = (success) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: `${url.origin}/?auth=${success ? "connected" : "error"}`,
        "Set-Cookie": cookie(request, "", 0),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  try {
    const body = request.method === "POST" ? await request.text() : "";
    if (body.length > 16384) return finish(false);
    const params =
      request.method === "POST" ? new URLSearchParams(body) : url.searchParams;
    const state = params.get("state"),
      code = params.get("code");
    const savedCookie = /\bwildbow_oauth=([a-f0-9]{64})\b/.exec(
      request.headers.get("Cookie") || "",
    )?.[1];
    if (!state || state !== savedCookie || !code || code.length > 4096)
      return finish(false);
    const flow = (await (await community(env, "/flow-use", { state })).json())
      .flow;
    if (!flow || flow.provider !== provider) return finish(false);
    const token = await fetch(p.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: env[p.id],
        client_secret: env[p.secret],
        ...(provider === "google" ? { code_verifier: flow.verifier } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!token.ok) return finish(false);
    const data = await token.json();
    if (typeof data.id_token !== "string" || data.id_token.length > 16384)
      return finish(false);
    if (!keys.has(provider))
      keys.set(
        provider,
        createRemoteJWKSet(new URL(p.jwks), { timeoutDuration: 8000 }),
      );
    const { payload } = await jwtVerify(data.id_token, keys.get(provider), {
      issuer: p.issuer,
      audience: env[p.id],
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "nonce"],
    });
    if (payload.nonce !== flow.nonce || typeof payload.sub !== "string")
      return finish(false);
    const identity = await profileId(
      await digestToken(`${provider}:${payload.sub}`),
    );
    const linked = await community(env, "/link", {
      identity,
      profileId: flow.profileId,
      guestId: flow.guestId,
    });
    if (!linked.ok) return finish(false);
    const { id } = await linked.json();
    const profile = await env.PROFILES.get(env.PROFILES.idFromName(id)).fetch(
      new Request("https://profile/identity", {
        method: "POST",
        body: JSON.stringify({ provider }),
      }),
    );
    return finish(profile.ok);
  } catch {
    return finish(false);
  }
}
async function digestToken(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
