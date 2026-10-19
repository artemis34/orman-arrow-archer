import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { ONLINE, roomCode, pauseStaleInput } from "../shared/online.js";

/** One authoritative world per room. No timers or bots run in an empty room. */
export class ArenaRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.sessions = new Map();
    this.world = null;
    this.events = [];
    this.ticks = 0;
    // A deploy/restart cannot restore an in-memory match. Tell clients to rejoin.
    for (const ws of ctx.getWebSockets()) ws.close(1012, "arena restarted");
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/status"))
      return Response.json({
        ok: true,
        humans: [...this.sessions.values()].filter((s) => s.joined).length,
        ticking: !!this.timer,
        time: this.world?.time || 0,
      });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket connection required", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    if (this.sessions.size >= ONLINE.humans) {
      server.send(JSON.stringify({ type: "full" }));
      server.close(1008, "arena full");
    } else {
      const session = {
        id: crypto.randomUUID(),
        joined: false,
        budget: 90,
        refill: Date.now(),
        lastInput: Date.now(),
        room: url.pathname.split("/").at(-1),
      };
      session.joinTimer = setTimeout(() => {
        if (!session.joined) {
          server.close(1008, "join timeout");
          this.remove(server);
        }
      }, 10000);
      this.sessions.set(server, session);
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  send(ws, type, data) {
    try {
      ws.send(JSON.stringify({ type, data }));
    } catch {
      this.remove(ws);
    }
  }
  webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;
    if (typeof message !== "string" || message.length > ONLINE.maxMessage) {
      ws.close(1009, "message too large");
      this.remove(ws);
      return;
    }
    const now = Date.now();
    session.budget = Math.min(
      90,
      session.budget + (now - session.refill) * 0.06,
    );
    session.refill = now;
    if (session.budget < 1) return;
    session.budget--;
    let packet;
    try {
      packet = JSON.parse(message);
    } catch {
      return;
    }
    if (!packet || typeof packet !== "object") return;
    const { type, data } = packet;
    if (
      type === "join" &&
      !session.joined &&
      data &&
      typeof data === "object"
    ) {
      this.world ||= new World();
      const player = this.world.addPlayer(session.id, data.name, data.skin);
      if (!player) {
        this.send(ws, "full");
        ws.close(1008, "arena full");
        this.remove(ws);
        return;
      }
      session.joined = true;
      clearTimeout(session.joinTimer);
      this.send(ws, "welcome", {
        id: player.id,
        obstacles: this.world.obstacles,
        rules: RULES,
        room: session.room,
      });
      if (!this.world || !this.sessions.has(ws)) return;
      this.send(ws, "state", this.world.snapshot(player.id));
      if (this.world && !this.timer)
        this.timer = setInterval(() => this.step(), 1000 / RULES.tick);
    } else if (session.joined && this.world) {
      if (type === "input" && data && typeof data === "object") {
        session.lastInput = now;
        this.world.setInput(session.id, data);
      } else if (type === "upgrade" && typeof data === "string")
        this.world.choose(session.id, data);
      else if (type === "respawn") this.world.respawn(session.id);
      else if (type === "ping") this.send(ws, "pong");
    }
  }
  step() {
    if (!this.world) return;
    const now = Date.now();
    for (const [ws, session] of this.sessions) {
      if (session.joined && now - session.lastInput > ONLINE.idleTimeout) {
        try {
          ws.close(1001, "inactive connection");
        } catch {}
        this.remove(ws);
        continue;
      }
      if (!this.world) return;
      const p = this.world.players.get(session.id);
      if (p) pauseStaleInput(p, now - session.lastInput);
    }
    if (!this.world) return;
    this.world.step();
    this.events.push(...this.world.events);
    if (++this.ticks % (RULES.tick / ONLINE.snapshots) !== 0) return;
    for (const [ws, session] of this.sessions) {
      if (session.joined && this.world)
        this.send(ws, "state", this.world.snapshot(session.id, this.events));
    }
    this.events.length = 0;
  }
  remove(ws) {
    const session = this.sessions.get(ws);
    if (!session) return;
    clearTimeout(session.joinTimer);
    this.world?.removePlayer(session.id);
    this.sessions.delete(ws);
    if (![...this.sessions.values()].some((s) => s.joined)) {
      clearInterval(this.timer);
      this.timer = null;
      this.world = null;
      this.events.length = 0;
      this.ticks = 0;
    }
  }
  webSocketClose(ws) {
    this.remove(ws);
  }
  webSocketError(ws) {
    try {
      ws.close(1011, "connection error");
    } catch {}
    this.remove(ws);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return Response.json({
        ok: true,
        transport: "websocket",
        tickRate: RULES.tick,
        snapshotRate: ONLINE.snapshots,
      });
    const match = /^\/api\/rooms\/([^/]+)(\/status)?$/.exec(url.pathname);
    if (match) {
      const code = roomCode(match[1]);
      if (!code || code !== match[1])
        return new Response("Invalid room", { status: 400 });
      const origin = request.headers.get("Origin");
      const allowed =
        env.ALLOWED_ORIGINS?.split(",").map((v) => v.trim()) || [];
      if (origin && origin !== url.origin && !allowed.includes(origin))
        return new Response("Origin denied", { status: 403 });
      if (request.method !== "GET")
        return new Response("Method not allowed", { status: 405 });
      return env.ARENAS.get(env.ARENAS.idFromName(code)).fetch(request);
    }
    if (url.pathname.startsWith("/api/"))
      return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
