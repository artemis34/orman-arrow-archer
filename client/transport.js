import { io } from "socket.io-client";
import { World } from "../shared/world.js";
import { advanceMovement, cleanInput, RULES } from "../shared/config.js";
/** Transport adapters isolate rendering from the authority implementation. */
export class LocalTransport {
  constructor() {
    this.world = new World();
    this.id = "local";
    this.online = false;
  }
  async connect(name, skin) {
    this.world.addPlayer(this.id, name, skin);
    return { id: this.id, obstacles: this.world.obstacles };
  }
  step(input) {
    this.world.setInput(this.id, input);
    this.world.step();
    return this.world.snapshot(this.id);
  }
  choose(k) {
    this.world.choose(this.id, k);
  }
  respawn() {
    this.world.respawn(this.id);
  }
  close() {}
}
export class SocketTransport {
  constructor(
    url,
    onState,
    onDisconnect,
    { createSocket = io, connectTimeout = 75000 } = {},
  ) {
    this.createSocket = createSocket;
    this.connectTimeout = connectTimeout;
    this.url = url;
    this.online = true;
    this.onState = onState;
    this.onDisconnect = onDisconnect;
    this.seq = 0;
    this.pending = [];
    this.snapshots = [];
    this.ping = 0;
    this.predicted = null;
  }
  connect(name, skin) {
    return new Promise((resolve, reject) => {
      let ready = false;
      this.socket = this.createSocket(this.url, {
        transports: ["websocket", "polling"],
        timeout: 60000,
        tryAllTransports: true,
        reconnection: false,
      });
      const timer = (this.connectTimer = setTimeout(() => {
        this.close();
        reject(
          new Error(
            "Sunucu yanıt vermedi. Ücretsiz sunucunun uyanması zaman alabilir.",
          ),
        );
      }, this.connectTimeout));
      this.socket.on("connect", () => this.socket.emit("join", { name, skin }));
      this.socket.on("welcome", (data) => {
        clearTimeout(timer);
        ready = true;
        this.id = data.id;
        this.obstacles = data.obstacles;
        resolve(data);
        this.pingTimer = setInterval(() => {
          const start = performance.now();
          this.socket.timeout(3000).emit("latency", (error) => {
            if (!error) this.ping = Math.round(performance.now() - start);
          });
        }, 2000);
      });
      this.socket.on("state", (state) => {
        const now = performance.now();
        this.snapshots.push({ state, at: now });
        while (this.snapshots.length > 8) this.snapshots.shift();
        const me = state.players.find((p) => p.id === this.id);
        if (me) {
          this.pending = this.pending.filter((i) => i.seq > me.seq);
          this.predicted = { ...me, upgrades: { ...me.upgrades } };
          if (this.predicted.alive)
            for (const i of this.pending)
              advanceMovement(
                this.predicted,
                i,
                1 / RULES.tick,
                this.obstacles,
              );
        }
        this.onState(state);
      });
      this.socket.on("full", () => {
        clearTimeout(timer);
        this.close();
        reject(new Error("Arena dolu. Biraz sonra tekrar dene."));
      });
      this.socket.on("connect_error", () => {
        if (!ready) {
          clearTimeout(timer);
          this.close();
          reject(
            new Error(
              "Sunucuya bağlanılamadı. Adresi kontrol et veya antrenmanı seç.",
            ),
          );
        }
      });
      this.socket.on("disconnect", () => {
        if (ready) this.onDisconnect();
        else {
          clearTimeout(timer);
          this.close();
          reject(
            new Error("Sunucu bağlantıyı kapattı. Tekrar deneyebilirsin."),
          );
        }
      });
    });
  }
  step(input) {
    input = cleanInput({ ...input, seq: ++this.seq });
    this.socket.emit("input", input);
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    if (this.predicted?.alive)
      advanceMovement(this.predicted, input, 1 / RULES.tick, this.obstacles);
  }

  view() {
    const last = this.snapshots.at(-1);
    if (!last) return null;
    const now = performance.now() - 90;
    let a = this.snapshots[0],
      b = last;
    for (let i = 1; i < this.snapshots.length; i++)
      if (this.snapshots[i].at >= now) {
        a = this.snapshots[i - 1];
        b = this.snapshots[i];
        break;
      }
    const t = Math.max(0, Math.min(1, (now - a.at) / (b.at - a.at || 1)));
    const old = new Map(a.state.players.map((p) => [p.id, p]));
    const buffered = new Map(b.state.players.map((p) => [p.id, p]));
    const oldArrows = new Map(a.state.arrows.map((p) => [p.id, p]));
    return {
      ...last.state,
      // Only transforms use the interpolation buffer. Life, protection, HP,
      // choices and visibility must reflect the newest authoritative snapshot.
      players: last.state.players.map((p) => {
        if (p.id === this.id && this.predicted)
          return {
            ...p,
            x: this.predicted.x,
            z: this.predicted.z,
            angle: this.predicted.angle,
          };
        const prev = old.get(p.id);
        const next = buffered.get(p.id);
        if (
          !prev ||
          !next ||
          !p.alive ||
          !prev.alive ||
          !next.alive ||
          p.levelGuard > 0 ||
          Math.hypot(p.x - next.x, p.z - next.z) > 8 ||
          Math.hypot(next.x - prev.x, next.z - prev.z) > 8
        )
          return p;
        const da = Math.atan2(
          Math.sin(next.angle - prev.angle),
          Math.cos(next.angle - prev.angle),
        );
        return {
          ...p,
          x: prev.x + (next.x - prev.x) * t,
          z: prev.z + (next.z - prev.z) * t,
          angle: prev.angle + da * t,
        };
      }),
      arrows: b.state.arrows.map((p) => {
        const prev = oldArrows.get(p.id);
        return prev
          ? {
              ...p,
              x: prev.x + (p.x - prev.x) * t,
              z: prev.z + (p.z - prev.z) * t,
            }
          : p;
      }),
    };
  }
  choose(k) {
    this.socket.emit("upgrade", k);
  }
  respawn() {
    this.socket.emit("respawn");
  }
  close() {
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
  }
}
