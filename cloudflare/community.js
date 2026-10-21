import { rankFor, titleFor } from "../shared/ranking.js";
const validCode = (value) =>
  typeof value === "string" && /^[A-F0-9]{12}$/.test(value);
const cleanName = (value) =>
  String(value || "Gezgin")
    .replace(/[<>\x00-\x1f]/g, "")
    .trim()
    .slice(0, 16) || "Gezgin";
/** Private binding only. Public routes never forward arbitrary internal paths. */
export class CommunityHub {
  constructor(ctx) {
    this.ctx = ctx;
    this.budgets = new Map();
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS players(code TEXT PRIMARY KEY,name TEXT NOT NULL,points INTEGER NOT NULL,kills INTEGER NOT NULL,matches INTEGER NOT NULL,rankedMatches INTEGER NOT NULL,wins INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS ranked_order ON players(points DESC,rankedMatches DESC)",
    );
    ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS kills_order ON players(kills DESC)",
    );
  }
  row(code) {
    return (
      this.ctx.storage.sql
        .exec("SELECT * FROM players WHERE code = ?", code)
        .toArray()[0] || null
    );
  }
  public(row) {
    if (!row) return null;
    return { ...row, rank: rankFor(row.points), title: titleFor(row.kills) };
  }
  fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url),
        path = url.pathname;
      const data = request.method === "POST" ? await request.json() : {};
      if (path === "/upsert") {
        if (!validCode(data.code))
          return Response.json({ error: "Geçersiz profil." }, { status: 400 });
        const safe = (v) =>
          Math.min(1e9, Math.max(0, Math.floor(Number(v) || 0)));
        this.ctx.storage.sql.exec(
          "INSERT INTO players(code,name,points,kills,matches,rankedMatches,wins) VALUES(?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,points=excluded.points,kills=excluded.kills,matches=excluded.matches,rankedMatches=excluded.rankedMatches,wins=excluded.wins",
          data.code,
          cleanName(data.name),
          safe(data.points),
          safe(data.kills),
          safe(data.matches),
          safe(data.rankedMatches),
          safe(data.wins),
        );
        return Response.json({ ok: true });
      }
      if (path === "/leaderboard") {
        const ranked = url.searchParams.get("kind") !== "kills";
        const rows = this.ctx.storage.sql
          .exec(
            ranked
              ? "SELECT * FROM players WHERE rankedMatches>0 ORDER BY points DESC,wins DESC,code ASC LIMIT 50"
              : "SELECT * FROM players WHERE kills>0 ORDER BY kills DESC,wins DESC,code ASC LIMIT 50",
          )
          .toArray();
        return Response.json({ entries: rows.map((r) => this.public(r)) });
      }
      if (path === "/resolve")
        return Response.json({
          id: (await this.ctx.storage.get(`alias:${data.id}`)) || data.id,
        });
      if (path === "/flow-create") {
        const key = `auth:${data.flow.guestId}`,
          now = Date.now(),
          b = this.budgets.get(key) || { at: now, count: 0 };
        if (now - b.at > 60000) {
          b.at = now;
          b.count = 0;
        }
        if (++b.count > 5)
          return Response.json(
            { error: "Biraz bekleyip tekrar dene." },
            { status: 429 },
          );
        if (this.budgets.size > 2048)
          this.budgets.delete(this.budgets.keys().next().value);
        this.budgets.set(key, b);
        await this.ctx.storage.put(`flow:${data.state}`, data.flow);
        if (this.ctx.storage.setAlarm && !(await this.ctx.storage.getAlarm()))
          await this.ctx.storage.setAlarm(Date.now() + 600000);
        return Response.json({ ok: true });
      }
      if (path === "/flow-use") {
        const key = `flow:${data.state}`,
          flow = await this.ctx.storage.get(key);
        if (flow) await this.ctx.storage.delete(key);
        return Response.json({
          flow: flow && flow.expires > Date.now() ? flow : null,
        });
      }
      if (path === "/link") {
        const key = `identity:${data.identity}`;
        const id = (await this.ctx.storage.get(key)) || data.profileId;
        await this.ctx.storage.put(key, id);
        await this.ctx.storage.put(`alias:${data.guestId}`, id);
        return Response.json({ id });
      }
      const code = url.searchParams.get("code") || data.code;
      if (!validCode(code) || !this.row(code))
        return Response.json({ error: "Profil bulunamadı." }, { status: 404 });
      const key = `friends:${code}`;
      const graph = (await this.ctx.storage.get(key)) || {
        friends: [],
        incoming: [],
        outgoing: [],
      };
      if (path === "/friends")
        return Response.json({
          code,
          friends: graph.friends
            .map((c) => this.public(this.row(c)))
            .filter(Boolean),
          incoming: graph.incoming
            .map((c) => this.public(this.row(c)))
            .filter(Boolean),
          outgoing: graph.outgoing
            .map((c) => this.public(this.row(c)))
            .filter(Boolean),
        });
      if (!["/request", "/accept", "/remove", "/decline"].includes(path))
        return new Response("Not found", { status: 404 });
      const target = (typeof data.target === "string" ? data.target : "")
        .toUpperCase()
        .replaceAll("-", "");
      if (!validCode(target) || target === code || !this.row(target))
        return Response.json(
          { error: "Geçerli bir arkadaş kodu gir." },
          { status: 400 },
        );
      const now = Date.now(),
        budget = this.budgets.get(code) || { at: now, count: 0 };
      if (now - budget.at > 60000) {
        budget.at = now;
        budget.count = 0;
      }
      if (++budget.count > 30)
        return Response.json(
          { error: "Biraz bekleyip tekrar dene." },
          { status: 429 },
        );
      if (this.budgets.size > 2048)
        this.budgets.delete(this.budgets.keys().next().value);
      this.budgets.set(code, budget);
      const otherKey = `friends:${target}`,
        other = (await this.ctx.storage.get(otherKey)) || {
          friends: [],
          incoming: [],
          outgoing: [],
        };
      if (path === "/request" && !graph.friends.includes(target)) {
        if (graph.outgoing.length >= 20 || other.incoming.length >= 20)
          return Response.json(
            { error: "İstek kutusu dolu." },
            { status: 409 },
          );
        if (!graph.outgoing.includes(target)) graph.outgoing.push(target);
        if (!other.incoming.includes(code)) other.incoming.push(code);
      }
      if (path === "/accept") {
        if (!graph.incoming.includes(target) || !other.outgoing.includes(code))
          return Response.json({ error: "İstek bulunamadı." }, { status: 409 });
        if (graph.friends.length >= 50 || other.friends.length >= 50)
          return Response.json(
            { error: "Arkadaş listesi dolu." },
            { status: 409 },
          );
        if (!graph.friends.includes(target)) graph.friends.push(target);
        if (!other.friends.includes(code)) other.friends.push(code);
      }
      if (path !== "/request") {
        for (const list of ["incoming", "outgoing"]) {
          graph[list] = graph[list].filter((c) => c !== target);
          other[list] = other[list].filter((c) => c !== code);
        }
        if (path === "/remove") {
          graph.friends = graph.friends.filter((c) => c !== target);
          other.friends = other.friends.filter((c) => c !== code);
        }
      }
      await this.ctx.storage.put(key, graph);
      await this.ctx.storage.put(otherKey, other);
      return Response.json({ ok: true });
    });
  }
  async alarm() {
    const flows = await this.ctx.storage.list({ prefix: "flow:" });
    let next = Infinity;
    for (const [key, flow] of flows)
      if (flow.expires <= Date.now()) await this.ctx.storage.delete(key);
      else next = Math.min(next, flow.expires);
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
}
export const community = (env, path, data) =>
  env.COMMUNITY.get(env.COMMUNITY.idFromName("global")).fetch(
    new Request(
      `https://community${path}`,
      data ? { method: "POST", body: JSON.stringify(data) } : {},
    ),
  );
export async function canonicalProfile(env, id) {
  if (!id || !env.COMMUNITY) return id;
  const r = await community(env, "/resolve", { id });
  if (!r.ok) throw new Error("Profil doğrulanamadı.");
  return (await r.json()).id;
}
