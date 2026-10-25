import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import {
  ONLINE,
  roomCode,
  pauseStaleInput,
  populationFor,
} from "../shared/online.js";
import { PROTOCOL, SnapshotEncoder, decodeInputs } from "../shared/protocol.js";
import { FORMATS, formatKey, createMode } from "../shared/modes.js";
import { profileId, sanitizeCosmetics } from "../shared/profile.js";
import { sendEmote, drainEmotes } from "../shared/emotes.js";
export { PlayerProfile } from "./profile.js";
export { CommunityHub } from "./community.js";
import { community, canonicalProfile } from "./community.js";
import { authFetch } from "./auth.js";
const ACTIVITY_KEYS = ["kills", "hits", "assists", "objectives"];

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
    this.instance = crypto.randomUUID();
    this.awardedRound = 0;
    // A deploy/restart cannot restore an in-memory match. Tell clients to rejoin.
    for (const ws of ctx.getWebSockets()) ws.close(1012, "arena restarted");
  }
  async fetch(request) {
    const url = new URL(request.url);
    const requestedFormat = formatKey(url.searchParams.get("format"));
    if (!this.sessions.size && !this.reservations.size && !this.world)
      this.format = requestedFormat;
    this.format ||= requestedFormat;
    const capacity = FORMATS[this.format].capacity;
    if (url.pathname === "/reserve" && request.method === "POST") {
      if (
        requestedFormat !== this.format ||
        this.world?.mode.acceptsPlayers === false ||
        this.sessions.size + this.reservations.size >= capacity
      )
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
        format: this.format,
        capacity,
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
      requestedFormat !== this.format ||
      this.world?.mode.acceptsPlayers === false ||
      this.sessions.size + this.reservations.size >= capacity ||
      (ticket && !reservation) ||
      (FORMATS[this.format].ranked && !reservation)
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
  async webSocketMessage(ws, message) {
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
      !session.joining &&
      data &&
      typeof data === "object"
    ) {
      session.joining = true;
      let profile = null;
      if (this.env?.PROFILES) {
        try {
          session.profileId = await canonicalProfile(
            this.env,
            await profileId(data.profileToken),
          );
        } catch {
          session.profileId = null;
        }
        if (session.profileId) {
          try {
            const response = await this.env.PROFILES.get(
              this.env.PROFILES.idFromName(session.profileId),
            ).fetch(
              new Request("https://profile/name", {
                method: "POST",
                body: JSON.stringify({ name: data.name }),
              }),
            );
            profile = (await response.json()).profile;
          } catch {
            session.profileId = null;
          }
        }
      }
      if (!this.sessions.has(ws)) return;
      if (
        FORMATS[this.format]?.ranked &&
        (!profile ||
          [...this.sessions.values()].some(
            (s) => s !== session && s.profileId === session.profileId,
          ))
      ) {
        this.send(ws, "error", {
          message: "Ranked için iki farklı online profil gerekir.",
        });
        ws.close(1008, "ranked identity required");
        this.remove(ws);
        return;
      }
      if (!this.world) {
        this.world = new World({
          bots: 0,
          mode: createMode(this.format || "arena"),
        });
        this.instance = crypto.randomUUID();
        this.awardedRound = 0;
      }
      const humans = [...this.world.players.values()].filter(
        (p) => !p.bot,
      ).length;
      const population = populationFor(this.world.mode.id);
      this.world.setBotCount(Math.max(0, population - humans - 1));
      const player = this.world.addPlayer(
        session.id,
        data.name,
        data.skin,
        false,
        {
          cosmetics: sanitizeCosmetics(profile),
          // Sharing a friend room deliberately groups its humans, within team capacity.
          party: !/(?:^|-)wildbow-\d+$/.test(session.room) ? "friends" : "",
        },
      );
      if (!player) {
        this.send(ws, "full");
        ws.close(1008, "arena full");
        this.remove(ws);
        return;
      }
      session.joined = true;
      session.joining = false;
      session.joinedAt = this.world.time;
      session.viewRadius = viewRadius(data.viewRadius);
      if (data.protocol === PROTOCOL) session.encoder = new SnapshotEncoder();
      clearTimeout(session.joinTimer);
      this.send(ws, "welcome", {
        id: player.id,
        obstacles: this.world.obstacles,
        rules: RULES,
        room: session.room,
        protocol: session.encoder ? PROTOCOL : 0,
        format: this.format,
      });
      if (!this.world || !this.sessions.has(ws)) return;
      this.reportPresence();
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
      else if (type === "reroll") this.world.reroll(session.id);
      else if (type === "rematch")
        this.world.mode.vote?.(this.world, session.id);
      else if (type === "emote") sendEmote(this.world, session.id, data);
      else if (type === "ping") this.send(ws, "pong");
      else if (type === "view") session.viewRadius = viewRadius(data);
    }
  }
  reportPresence() {
    if (!this.env?.COMMUNITY || !this.world) return;
    const session = [...this.sessions.values()].find((s) => s.joined);
    const count = [...this.sessions.values()].filter((s) => s.joined).length;
    const key =
      this.presenceRoom || (session && `${this.format}:${session.room}`);
    if (!key) return;
    this.presenceRoom = key;
    this.ctx.waitUntil(
      community(this.env, "/presence", {
        room: key,
        instance: this.instance,
        count,
      }).catch(() => {}),
    );
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
    if (
      !this.env?.MATCHMAKER ||
      !/^(?:[a-z0-9]+-)?wildbow-\d+$/.test(room || "")
    )
      return;
    this.ctx.waitUntil(
      this.env.MATCHMAKER.get(
        this.env.MATCHMAKER.idFromName(
          this.format && this.format !== "arena"
            ? `public:${this.format}`
            : "public",
        ),
      )
        .fetch(
          new Request(
            `https://internal/available?format=${this.format || "arena"}`,
            {
              method: "POST",
              body: JSON.stringify({ room }),
            },
          ),
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
    const previousRound = this.world.mode.round;
    const previousPhase = this.world.mode.phase;
    for (const s of this.sessions.values()) {
      const p = this.world.players.get(s.id);
      if (!p) continue;
      s.tickCounters ||= {};
      for (const key of ACTIVITY_KEYS) s.tickCounters[key] = p[key];
    }
    if (!this.presenceAt || now - this.presenceAt >= 30000) {
      this.presenceAt = now;
      this.reportPresence();
    }
    this.world.step();
    this.world.events.push(...drainEmotes(this.world));
    if (
      this.world.mode.rules?.ranked &&
      previousPhase !== "playing" &&
      this.world.mode.phase === "playing"
    ) {
      this.rankedSides = new Map(
        [...this.sessions.values()]
          .filter((s) => s.joined)
          .map((s) => [s.id, this.world.players.get(s.id)?.team]),
      );
      this.rankedStartedAt = this.world.time;
      this.rankedParticipants = new Map(
        [...this.sessions.values()]
          .filter((s) => s.joined)
          .map((s) => [s.id, s.profileId]),
      );
    }
    for (const [ws, s] of this.sessions) {
      const p = this.world.players.get(s.id),
        before = s.tickCounters;
      if (!p || !before || !s.profileId) continue;
      s.activity ||= { kills: 0, hits: 0, assists: 0, objectives: 0 };
      for (const key of ACTIVITY_KEYS)
        s.activity[key] += Math.max(0, p[key] - before[key]);
      if (this.world.time - (s.flushedAt || 0) >= 60) this.flushActivity(ws, s);
    }
    if (this.world.mode.round !== previousRound)
      for (const session of this.sessions.values()) session.inputs = [];
    this.rewardRound();
    this.events.push(...this.world.events);
    if (++this.ticks % (RULES.tick / ONLINE.snapshots) !== 0) return;
    for (const [ws, session] of this.sessions) {
      if (session.joined && this.world)
        this.send(ws, "state", this.snapshot(session));
    }
    this.events.length = 0;
  }
  rankedEligible(session) {
    return (
      !!this.world.mode.rules?.ranked &&
      !!this.world.mode.rules.battleRoyale &&
      this.rankedParticipants?.size >= 2 &&
      new Set(this.rankedParticipants?.values() || []).size ===
        this.rankedParticipants?.size &&
      (!this.world.mode.rules.teams ||
        new Set([...(this.rankedSides?.values() || [])]).size >= 2) &&
      this.rankedParticipants.get(session.id) === session.profileId
    );
  }
  rewardRound() {
    const mode = this.world?.mode;
    if (
      !this.env?.PROFILES ||
      mode?.phase !== "results" ||
      this.awardedRound === mode.round
    )
      return;
    this.awardedRound = mode.round;
    const top = mode.results[0];
    const high = Math.max(...mode.teamScores);
    const teamWinners = mode.teamScores
      .map((s, id) => (s === high ? id : -1))
      .filter((id) => id >= 0);
    for (const [ws, session] of this.sessions) {
      const p = this.world.players.get(session.id);
      const ranked = this.rankedEligible(session);
      if (
        !p ||
        !session.profileId ||
        (!ranked && this.world.time - session.joinedAt < 30)
      )
        continue;
      const win = mode.rules.battleRoyale
        ? mode.rules.teams
          ? mode.winnerTeam === p.team
          : mode.winnerId === p.id
        : mode.forfeit
          ? mode.forfeit !== session.id
          : p.team != null
            ? teamWinners.length === 1 && teamWinners[0] === p.team
            : top?.id === p.id &&
              (!mode.results[1] || top.points > mode.results[1].points);
      const draw = mode.rules.battleRoyale
        ? mode.winnerId == null
        : !mode.forfeit &&
          mode.results.length > 1 &&
          mode.results[0].points === mode.results[1].points;

      const awardData = {
        receipt: `${this.instance}:${mode.round}`,
        kills: p.kills,
        assists: p.assists,
        hits: p.hits,
        objectives: p.objectives,
        points: p.matchPoints,
        win,
        statsRecorded: true,
        ranked,
        rankMode: mode.rules.teams ? "duo" : "solo",
        outcome: draw ? "draw" : win ? "win" : "loss",
      };
      const task = this.flushActivity(ws, session)
        .then(() =>
          this.env.PROFILES.get(
            this.env.PROFILES.idFromName(session.profileId),
          ).fetch(
            new Request("https://profile/award", {
              method: "POST",
              body: JSON.stringify(awardData),
            }),
          ),
        )
        .then((r) => r.json())
        .then((data) => this.send(ws, "profile", data.profile))
        .catch(() => {});
      this.ctx.waitUntil(task);
    }
  }
  remove(ws) {
    const session = this.sessions.get(ws);
    if (!session) return;
    if (
      this.env?.PROFILES &&
      this.world?.mode.rules?.battleRoyale &&
      this.world.mode.phase === "playing" &&
      this.rankedEligible(session)
    ) {
      const p = this.world.players.get(session.id);
      const result = {
        receipt: `${this.instance}:${this.world.mode.round}`,
        ranked: true,
        rankMode: this.world.mode.rules.teams ? "duo" : "solo",
        win: false,
        outcome: "loss",
        statsRecorded: true,
        points: p?.matchPoints || 0,
        kills: p?.kills || 0,
      };
      this.ctx.waitUntil(
        this.flushActivity(ws, session)
          .then(() =>
            this.env.PROFILES.get(
              this.env.PROFILES.idFromName(session.profileId),
            ).fetch(
              new Request("https://profile/award", {
                method: "POST",
                body: JSON.stringify(result),
              }),
            ),
          )
          .catch(() => {}),
      );
    }
    this.flushActivity(ws, session);
    clearTimeout(session.joinTimer);
    this.world?.removePlayer(session.id);
    this.sessions.delete(ws);
    this.reportPresence();
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
          populationFor(this.world.mode.id) -
            [...this.world.players.values()].filter((p) => !p.bot).length,
        ),
      );
  }
  webSocketClose(ws) {
    this.remove(ws);
  }
  flushActivity(ws, session) {
    if (!this.env?.PROFILES || !session.profileId) return Promise.resolve();
    if (session.flushingActive) return session.flushing;
    if (
      !session.pendingActivity &&
      !Object.values(session.activity || {}).some(Boolean)
    )
      return Promise.resolve();
    session.flushedAt = this.world?.time || 0;
    session.flushingActive = true;
    const task = (async () => {
      // Keep the same receipt across a lost acknowledgement. A successful DB
      // write followed by a failed response must not duplicate lifetime kills.
      for (let batch = 0; batch < 2; batch++) {
        if (!session.pendingActivity) {
          if (!Object.values(session.activity || {}).some(Boolean)) break;
          session.pendingActivity = {
            ...session.activity,
            receipt: `${this.instance}:activity:${session.id}:${(session.activitySeq = (session.activitySeq || 0) + 1)}`,
          };
          session.activity = { kills: 0, hits: 0, assists: 0, objectives: 0 };
        }
        let result;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await this.env.PROFILES.get(
              this.env.PROFILES.idFromName(session.profileId),
            ).fetch(
              new Request("https://profile/activity", {
                method: "POST",
                body: JSON.stringify(session.pendingActivity),
                signal: AbortSignal.timeout(5000),
              }),
            );
            if (!response.ok) throw new Error("stats unavailable");
            result = await response.json();
            break;
          } catch {
            if (attempt === 1) return;
          }
        }
        session.pendingActivity = null;
        this.send(ws, "profile", result.profile);
      }
    })().finally(() => {
      session.flushingActive = false;
    });
    session.flushing = task;
    this.ctx.waitUntil(task);
    return task;
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
    const key = formatKey(new URL(request.url).searchParams.get("format"));
    const prefix = key === "arena" ? "" : `${key}-`;
    if (path === "/available") {
      const { room } = await request.json();
      const match = new RegExp(`^${prefix}wildbow-(\\d+)$`).exec(room || "");
      if (match && Number(match[1]) - 1 < this.cursor) {
        this.cursor = Math.max(0, Number(match[1]) - 1);
        await this.ctx.storage.put("cursor", this.cursor);
      }
      return new Response(null, { status: 204 });
    }
    const initial = this.cursor;
    for (let attempt = 0; attempt < ONLINE.publicRooms; attempt++) {
      const index = this.cursor,
        room = `${prefix}wildbow-${index + 1}`;
      const response = await this.env.ARENAS.get(
        this.env.ARENAS.idFromName(room),
      ).fetch(
        new Request(`https://internal/reserve?room=${room}&format=${key}`, {
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
        headers.set(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type",
        );
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        headers.append("Vary", "Origin");
      }
      return new Response(response.body, { status: response.status, headers });
    };
    if (url.pathname.startsWith("/api/")) {
      const appleCallback =
        url.pathname === "/api/auth/apple/callback" &&
        request.method === "POST" &&
        origin === "https://appleid.apple.com";
      if (
        origin &&
        origin !== url.origin &&
        !allowed.includes(origin) &&
        !appleCallback
      )
        return new Response("Origin denied", { status: 403 });
      if (request.method === "OPTIONS")
        return apiResponse(new Response(null, { status: 204 }));
      if (url.pathname.startsWith("/api/auth/")) {
        if (!["GET", "POST"].includes(request.method))
          return new Response("Method not allowed", { status: 405 });
        return authFetch(request, env);
      }
      if (
        request.method !== "GET" &&
        !(
          /^\/api\/profile\/(?:purchase|equip|name|friends\/(?:request|accept|decline|remove))$/.test(
            url.pathname,
          ) && request.method === "POST"
        )
      )
        return new Response("Method not allowed", { status: 405 });
    }
    if (
      /^\/api\/profile(?:\/(?:purchase|equip|name|friends)(?:\/(?:request|accept|decline|remove))?)?$/.test(
        url.pathname,
      )
    ) {
      const id = await canonicalProfile(
        env,
        await profileId(
          request.headers.get("Authorization")?.replace(/^Bearer /, ""),
        ),
      );
      if (!id) return new Response("Invalid profile key", { status: 401 });
      if (Number(request.headers.get("Content-Length")) > 2048)
        return new Response("Too large", { status: 413 });
      const action = url.pathname.slice("/api/profile/".length);
      const isRoot = url.pathname === "/api/profile";
      if (action.startsWith("friends")) {
        if (!env.COMMUNITY)
          return Response.json(
            { error: "Arkadaşlar şu anda yüklenemedi." },
            { status: 503 },
          );
        if (request.method !== (action === "friends" ? "GET" : "POST"))
          return new Response("Method not allowed", { status: 405 });
        const response = await env.PROFILES.get(
          env.PROFILES.idFromName(id),
        ).fetch(new Request("https://profile/"));
        const { profile } = await response.json();
        await community(env, "/upsert", {
          code: profile.socialCode,
          name: profile.displayName,
          ratings: profile.ratings,
          points: profile.ranked.points,
          rankedMatches: profile.ranked.matches,
          kills: profile.stats.kills,
          matches: profile.stats.matches,
          wins: profile.stats.wins,
        });
        const raw = request.method === "POST" ? await request.text() : "";
        if (raw.length > 2048)
          return new Response("Too large", { status: 413 });
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          return Response.json({ error: "Geçersiz istek." }, { status: 400 });
        }
        if (!data || typeof data !== "object" || Array.isArray(data))
          return Response.json({ error: "Geçersiz istek." }, { status: 400 });
        return apiResponse(
          await community(
            env,
            action === "friends"
              ? `/friends?code=${profile.socialCode}`
              : `/${action.split("/")[1]}`,
            request.method === "POST"
              ? { code: profile.socialCode, target: data.target }
              : undefined,
          ),
        );
      }
      if (!isRoot && request.method !== "POST")
        return new Response("Method not allowed", { status: 405 });
      if (isRoot && request.method !== "GET")
        return new Response("Method not allowed", { status: 405 });
      const body = request.method === "POST" ? await request.text() : undefined;
      if (body?.length > 2048)
        return new Response("Too large", { status: 413 });
      return apiResponse(
        await env.PROFILES.get(env.PROFILES.idFromName(id)).fetch(
          new Request(`https://profile/${isRoot ? "" : action}`, {
            method: request.method,
            body,
          }),
        ),
      );
    }
    if (url.pathname === "/api/leaderboard") {
      if (!env.COMMUNITY)
        return Response.json(
          { entries: [] },
          { headers: { "Cache-Control": "no-store" } },
        );
      return apiResponse(
        await community(
          env,
          `/leaderboard?kind=${["duo", "kills"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "solo"}`,
        ),
      );
    }
    if (url.pathname === "/api/matchmake") {
      const key = formatKey(url.searchParams.get("format"));
      return apiResponse(
        await env.MATCHMAKER.get(
          env.MATCHMAKER.idFromName(
            key === "arena" ? "public" : `public:${key}`,
          ),
        ).fetch(new Request(`https://internal/find?format=${key}`)),
      );
    }
    if (url.pathname === "/api/presence")
      return apiResponse(await community(env, "/presence"));
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
