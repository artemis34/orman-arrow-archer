import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { fileURLToPath } from "node:url";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
import { pauseStaleInput } from "../shared/online.js";
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
io.on("connection", (socket) => {
  if (io.sockets.sockets.size > 128) {
    socket.disconnect(true);
    return;
  }
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
    const humans = [...world.players.values()].filter((p) => !p.bot).length;
    if (humans >= 16) {
      socket.emit("full");
      return;
    }
    const p = world.addPlayer(socket.id, data.name, data.skin);
    if (!p) {
      socket.emit("full");
      return;
    }
    joined = true;
    socket.emit("welcome", {
      id: p.id,
      obstacles: world.obstacles,
      rules: RULES,
    });
  });
  socket.on("input", (data) => {
    if (joined && permit() && data && typeof data === "object") {
      lastInput = Date.now();
      world.setInput(socket.id, data);
    }
  });
  socket.on("upgrade", (key) => {
    if (joined && permit() && typeof key === "string")
      world.choose(socket.id, key);
  });
  socket.on("respawn", () => {
    if (joined && permit()) world.respawn(socket.id);
  });
  socket.on("latency", (cb) => {
    if (permit() && typeof cb === "function") cb();
  });
  const watchdog = setInterval(() => {
    const p = world.players.get(socket.id);
    if (p) pauseStaleInput(p, Date.now() - lastInput);
  }, 100);
  socket.on("disconnect", () => {
    clearInterval(watchdog);
    world.removePlayer(socket.id);
  });
});
setInterval(() => {
  world.step();
  for (const [id, socket] of io.sockets.sockets)
    if (world.players.has(id)) socket.emit("state", world.snapshot(id));
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
