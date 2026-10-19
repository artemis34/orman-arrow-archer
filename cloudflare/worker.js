import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { ONLINE, roomCode, pauseStaleInput } from "../shared/online.js";
import { PROTOCOL, SnapshotEncoder, decodeInputs } from "../shared/protocol.js";

/** One authoritative world per room. No timers or bots run in an empty room. */
export class ArenaRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sessions = new Map();
    this.reservations = new Map();
    this.world = null;
    this.events = [];
    this.ticks = 0;
    // A deploy/restart cannot restore an in-memory match. Tell clients to rejoin.
    for (const ws of ctx.getWebSockets()) ws.close(1012, "arena restarted");
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/reserve" && request.method === "POST") {
      if (this.sessions.size + this.reservations.size >= ONLINE.humans)
        return new Response("Full", { status: 409 });
      const ticket = crypto.randomUUID(),
        room = url.searchParams.get("room");
      const timer = setTimeout(() => {
        this.reservations.delete(ticket);
        this.available(room);
      }, ONLINE.reservationTime);
      this.reservations.set(ticket, timer);
      return Response.json(
        { room, ticket },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
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
    const ticket = url.searchParams.get("ticket"),
      reservation = this.reservations.get(ticket);
    if (reservation) {
      clearTimeout(reservation);
      this.reservations.delete(ticket);
    }
    if (
      this.sessions.size + this.reservations.size >= ONLINE.humans ||
      (ticket && !reservation)
    ) {
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
        inputs: [],
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
      const session = this.sessions.get(ws);
      ws.send(
        type === "state" && session?.encoder
          ? session.encoder.encode(data)
          : JSON.stringify({ type, data }),
      );
    } catch {
      this.remove(ws);
    }
  }
  webSocketMessage(ws, message) {
    const session = this.sessions.get(ws);
    if (!session) return;
    if (
      (typeof message === "string" ? message.length : message.byteLength) >
      ONLINE.maxMessage
    ) {
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
    if (typeof message !== "string") {
      if (!session.joined || !session.encoder) return;
      try {
        const inputs = decodeInputs(message);
        session.inputs ||= [];
        for (const input of inputs) {
          if (input.seq <= (session.lastSequence || 0)) continue;
          session.lastSequence = input.seq;
          session.inputs.push(input);
        }
        // Bounded backlog preserves ordinary batches without accepting speed hacks.
        while (session.inputs.length > 6) {
          const skipped = session.inputs.shift(),
            next = session.inputs[0];
          for (const key of ["dash", "heal", "quickShot", "cancelShot"])
            next[key] ||= skipped[key];
          if (next.lockTarget === undefined)
            next.lockTarget = skipped.lockTarget;
        }
        session.lastInput = now;
      } catch {}
      return;
    }
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
      this.world ||= new World({ bots: 0 });
      const humans = [...this.world.players.values()].filter(
        (p) => !p.bot,
      ).length;
      this.world.setBotCount(Math.max(0, ONLINE.roomPopulation - humans - 1));
      const player = this.world.addPlayer(session.id, data.name, data.skin);
      if (!player) {
        this.send(ws, "full");
        ws.close(1008, "arena full");
        this.remove(ws);
        return;
      }
      session.joined = true;
      session.viewRadius = viewRadius(data.viewRadius);
      if (data.protocol === PROTOCOL) session.encoder = new SnapshotEncoder();
      clearTimeout(session.joinTimer);
      this.send(ws, "welcome", {
        id: player.id,
        obstacles: this.world.obstacles,
        rules: RULES,
        room: session.room,
        protocol: session.encoder ? PROTOCOL : 0,
      });
      if (!this.world || !this.sessions.has(ws)) return;
      this.send(ws, "state", this.snapshot(session));
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
      else if (type === "view") session.viewRadius = viewRadius(data);
    }
  }
  snapshot(session) {
    return this.world.snapshot(
      session.id,
      this.events,
      session.encoder
        ? { radius: session.viewRadius || ONLINE.interestRadius }
        : {},
    );
  }
  available(room) {
    if (!this.env?.MATCHMAKER || !/^wildbow-\d+$/.test(room || "")) return;
    this.ctx.waitUntil(
      this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName("public"))
        .fetch(
          new Request("https://internal/available", {
            method: "POST",
            body: JSON.stringify({ room }),
          }),
        )
        .catch(() => {}),
    );
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
      if (p && session.inputs?.length)
        this.world.setInput(session.id, session.inputs.shift());
      if (p) pauseStaleInput(p, now - session.lastInput);
    }
    if (!this.world) return;
    this.world.step();
    this.events.push(...this.world.events);
    if (++this.ticks % (RULES.tick / ONLINE.snapshots) !== 0) return;
    for (const [ws, session] of this.sessions) {
      if (session.joined && this.world)
        this.send(ws, "state", this.snapshot(session));
    }
    this.events.length = 0;
  }
  remove(ws) {
    const session = this.sessions.get(ws);
    if (!session) return;
    clearTimeout(session.joinTimer);
    this.world?.removePlayer(session.id);
    this.sessions.delete(ws);
    this.available(session.room);
    if (![...this.sessions.values()].some((s) => s.joined)) {
      clearInterval(this.timer);
      this.timer = null;
      this.world = null;
      this.events.length = 0;
      this.ticks = 0;
    } else if (this.world)
      this.world.setBotCount(
        Math.max(
          0,
          ONLINE.roomPopulation -
            [...this.world.players.values()].filter((p) => !p.bot).length,
        ),
      );
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
function viewRadius(value) {
  return Number.isFinite(value)
    ? Math.min(80, Math.max(ONLINE.interestRadius, value))
    : ONLINE.interestRadius;
}

/** Only matchmaking uses storage; active matches remain in their own room. */
export class ArenaMatchmaker {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.cursor = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.cursor = (await ctx.storage.get("cursor")) || 0;
    });
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/available") {
      const { room } = await request.json();
      const match = /^wildbow-(\d+)$/.exec(room || "");
      if (match && Number(match[1]) - 1 < this.cursor) {
        this.cursor = Math.max(0, Number(match[1]) - 1);
        await this.ctx.storage.put("cursor", this.cursor);
      }
      return new Response(null, { status: 204 });
    }
    const initial = this.cursor;
    for (let attempt = 0; attempt < ONLINE.publicRooms; attempt++) {
      const index = this.cursor,
        room = `wildbow-${index + 1}`;
      const response = await this.env.ARENAS.get(
        this.env.ARENAS.idFromName(room),
      ).fetch(
        new Request(`https://internal/reserve?room=${room}`, {
          method: "POST",
        }),
      );
      if (response.ok) {
        if (this.cursor !== initial)
          await this.ctx.storage.put("cursor", this.cursor);
        return response;
      }
      this.cursor = (index + 1) % ONLINE.publicRooms;
    }
    return new Response("Arenalar şu anda dolu. Biraz sonra tekrar dene.", {
      status: 503,
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin"),
      allowed = env.ALLOWED_ORIGINS?.split(",").map((v) => v.trim()) || [];
    const apiResponse = (response) => {
      if (response.status === 101) return response;
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.append("Vary", "Origin");
      }
      return new Response(response.body, { status: response.status, headers });
    };
    if (url.pathname.startsWith("/api/")) {
      if (origin && origin !== url.origin && !allowed.includes(origin))
        return new Response("Origin denied", { status: 403 });
      if (request.method !== "GET")
        return new Response("Method not allowed", { status: 405 });
    }
    if (url.pathname === "/api/matchmake")
      return apiResponse(
        await env.MATCHMAKER.get(env.MATCHMAKER.idFromName("public")).fetch(
          new Request("https://internal/find"),
        ),
      );
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
      return apiResponse(
        await env.ARENAS.get(env.ARENAS.idFromName(code)).fetch(request),
      );
    }
    if (url.pathname.startsWith("/api/"))
      return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
