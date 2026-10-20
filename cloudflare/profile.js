import {
  newProfile,
  purchase,
  equip,
  award,
  publicProfile,
} from "../shared/profile.js";
/** A bearer recovery key selects this private object; it is never returned. */
export class PlayerProfile {
  constructor(ctx) {
    this.ctx = ctx;
  }
  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const profile = (await this.ctx.storage.get("profile")) || newProfile();
      const path = new URL(request.url).pathname;
      let outcome = { ok: true },
        changed = false;
      if (request.method === "POST") {
        let data;
        try {
          data = await request.json();
        } catch {
          return Response.json({ error: "Geçersiz istek." }, { status: 400 });
        }
        if (path === "/award") changed = award(profile, data);
        else if (path === "/purchase") {
          outcome = purchase(profile, data?.id);
          changed = outcome.ok;
        } else if (path === "/equip") {
          outcome = equip(profile, data?.id);
          changed = outcome.ok;
        } else return new Response("Not found", { status: 404 });
      }
      if (changed) await this.ctx.storage.put("profile", profile);
      return Response.json(
        { ...outcome, profile: publicProfile(profile) },
        { status: outcome.error ? 400 : 200 },
      );
    });
  }
}
