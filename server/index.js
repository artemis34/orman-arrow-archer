import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { fileURLToPath } from "node:url";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { pauseStaleInput } from "../shared/online.js";
import { createMode, FORMATS, formatKey } from "../shared/modes.js";
import { sanitizeCosmetics } from "../shared/profile.js";
const app = express(),
  http = createServer(app),
  production = process.env.NODE_ENV === "production";
app.disable("x-powered-by");
app.get("/health", (_req, res) =>
  res.json({ ok: true, players: world.players.size, tickRate: RULES.tick }),
);
const allowed = process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim());
const io = new Server(http, {
  cors: { origin: allowed || true, methods: ["GET", "POST"] },
  maxHttpBufferSize: 4096,
  pingTimeout: 15000,
  allowRequest: (req, done) =>
    done(
      null,
      !allowed || !req.headers.origin || allowed.includes(req.headers.origin),
    ),
});
const world = new World();
const worlds = new Map([["arena:public", world]]);
io.on("connection", (socket) => {
  if (io.sockets.sockets.size > 128) {
    socket.disconnect(true);
    return;
  }
  let activeWorld = world,
    roomKey = "arena:public";
  let joined = false,
    budget = 90,
    refill = Date.now(),
    lastInput = Date.now();
  const permit = () => {
    const now = Date.now();
    budget = Math.min(90, budget + (now - refill) * 0.06);
    refill = now;
    if (budget < 1) return false;
    budget--;
    return true;
  };
  socket.on("join", (data) => {
    if (joined || !permit() || !data || typeof data !== "object") return;
    const format = formatKey(data.format);
    const room =
      typeof data.room === "string" && /^[a-z0-9-]{3,24}$/.test(data.room)
        ? data.room
        : "public";
    roomKey = `${format}:${room}`;
    if (!worlds.has(roomKey))
      worlds.set(roomKey, new World({ bots: 0, mode: createMode(format) }));
    activeWorld = worlds.get(roomKey);
    const humans = [...activeWorld.players.values()].filter(
      (p) => !p.bot,
    ).length;
    if (humans >= FORMATS[format].capacity) {
      socket.emit("full");
      return;
    }
    activeWorld.setBotCount(
      Math.max(
        0,
        (format === "duel" ? 0 : Math.min(8, FORMATS[format].capacity)) -
          humans -
          1,
      ),
    );
    const p = activeWorld.addPlayer(socket.id, data.name, data.skin, false, {
      cosmetics: sanitizeCosmetics(null),
      party: room === "public" ? "" : "friends",
    });
    if (!p) {
      socket.emit("full");
      return;
    }
    joined = true;
    socket.data.world = activeWorld;
    socket.emit("welcome", {
      id: p.id,
      obstacles: activeWorld.obstacles,
      rules: RULES,
      format,
    });
  });
  socket.on("input", (data) => {
    if (joined && permit() && data && typeof data === "object") {
      lastInput = Date.now();
      activeWorld.setInput(socket.id, data);
    }
  });
  socket.on("upgrade", (key) => {
    if (joined && permit() && typeof key === "string")
      activeWorld.choose(socket.id, key);
  });
  socket.on("respawn", () => {
    if (joined && permit()) activeWorld.respawn(socket.id);
  });
  socket.on("reroll", () => {
    if (joined && permit()) activeWorld.reroll(socket.id);
  });
  socket.on("rematch", () => {
    if (joined && permit()) activeWorld.mode.vote?.(activeWorld, socket.id);
  });
  socket.on("latency", (cb) => {
    if (permit() && typeof cb === "function") cb();
  });
  const watchdog = setInterval(() => {
    const p = activeWorld.players.get(socket.id);
    if (p) pauseStaleInput(p, Date.now() - lastInput);
  }, 100);
  socket.on("disconnect", () => {
    clearInterval(watchdog);
    activeWorld.removePlayer(socket.id);
    const humans = [...activeWorld.players.values()].filter(
      (p) => !p.bot,
    ).length;
    if (!humans && roomKey !== "arena:public") worlds.delete(roomKey);
    else
      activeWorld.setBotCount(
        Math.max(
          0,
          (activeWorld.mode.rules?.duel
            ? 0
            : Math.min(8, activeWorld.mode.rules?.capacity || 16)) - humans,
        ),
      );
  });
});
setInterval(() => {
  for (const w of worlds.values()) w.step();
  for (const [id, socket] of io.sockets.sockets)
    if (socket.data.world?.players.has(id))
      socket.emit("state", socket.data.world.snapshot(id));
}, 1000 / RULES.tick);
if (production) {
  app.use(express.static(fileURLToPath(new URL("../dist", import.meta.url))));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server: http } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
http.listen(Number(process.env.PORT) || 3000, "0.0.0.0", () =>
  console.log(`Archer.io listening on ${Number(process.env.PORT) || 3000}`),
);
