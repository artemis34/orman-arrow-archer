import {
  newProfile,
  purchase,
  equip,
  award,
  publicProfile,
  recordActivity,
} from "../shared/profile.js";
import { community } from "./community.js";
/** A bearer recovery key selects this private object; it is never returned. */
export class PlayerProfile {
  constructor(ctx, env = {}) {
    this.ctx = ctx;
    this.env = env;
  }
  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get("profile");
      const needsMigration =
        !stored || !stored.socialCode || !stored.ranked || !stored.displayName;
      const profile = stored || newProfile();
      if (!profile.socialCode)
        profile.socialCode = crypto
          .randomUUID()
          .replaceAll("-", "")
          .slice(0, 12)
          .toUpperCase();
      profile.ranked ||= { points: 0, matches: 0, wins: 0 };
      profile.displayName ||= "Gezgin";
      const path = new URL(request.url).pathname;
      let outcome = { ok: true },
        changed = needsMigration;
      if (request.method === "POST") {
        let data;
        try {
          data = await request.json();
        } catch {
          return Response.json({ error: "Geçersiz istek." }, { status: 400 });
        }
        if (!data || typeof data !== "object" || Array.isArray(data))
          return Response.json({ error: "Geçersiz istek." }, { status: 400 });
        if (path === "/award") changed = award(profile, data);
        else if (path === "/activity") changed = recordActivity(profile, data);
        else if (path === "/name") {
          profile.displayName =
            (typeof data.name === "string" ? data.name : "Gezgin")
              .replace(/[<>\x00-\x1f]/g, "")
              .trim()
              .slice(0, 16) || "Gezgin";
          changed = true;
        } else if (
          path === "/identity" &&
          ["google", "apple"].includes(data.provider)
        ) {
          profile.accounts ||= [];
          if (!profile.accounts.includes(data.provider))
            profile.accounts.push(data.provider);
          changed = true;
        } else if (path === "/purchase") {
          outcome = purchase(profile, data?.id);
          changed = outcome.ok;
        } else if (path === "/equip") {
          outcome = equip(profile, data?.id);
          changed = outcome.ok;
        } else return new Response("Not found", { status: 404 });
      }
      if (changed) await this.ctx.storage.put("profile", profile);
      if (this.env.COMMUNITY) {
        const sync = () =>
          community(this.env, "/upsert", {
            code: profile.socialCode,
            name: profile.displayName,
            points: profile.ranked.points,
            rankedMatches: profile.ranked.matches,
            kills: profile.stats.kills,
            matches: profile.stats.matches,
            wins: profile.stats.wins,
          }).catch(() => {});
        if (changed) await sync();
        else this.ctx.waitUntil?.(sync());
      }
      return Response.json(
        { ...outcome, profile: publicProfile(profile) },
        { status: outcome.error ? 400 : 200 },
      );
    });
  }
}
