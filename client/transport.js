import { io } from "socket.io-client";
import { World } from "../shared/world.js";
import { moveBody, RULES } from "../shared/config.js";
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
  constructor(url, onState, onDisconnect) {
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
      this.socket = io(this.url, {
        transports: ["websocket", "polling"],
        timeout: 15000,
        reconnection: false,
      });
      const timer = setTimeout(() => {
        this.close();
        reject(
          new Error(
            "Sunucu yanıt vermedi. Ücretsiz sunucunun uyanması zaman alabilir.",
          ),
        );
      }, 25000);
      this.socket.on("connect", () => this.socket.emit("join", { name, skin }));
      this.socket.on("welcome", (data) => {
        clearTimeout(timer);
        ready = true;
        this.id = data.id;
        this.obstacles = data.obstacles;
        resolve(data);
        this.pingTimer = setInterval(() => {
          const start = performance.now();
          this.socket.timeout(3000).emit("latency", () => {
            this.ping = Math.round(performance.now() - start);
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
          for (const i of this.pending) {
            this.predicted.dashTime = Math.max(
              0,
              this.predicted.dashTime - 1 / RULES.tick,
            );
            moveBody(this.predicted, i, 1 / RULES.tick, this.obstacles);
          }
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
      });
    });
  }
  step(input) {
    input = { ...input, seq: ++this.seq };
    this.socket.emit("input", input);
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    if (this.predicted?.alive) {
      if (input.dash && this.predicted.dashCd <= 0) {
        const l = Math.hypot(input.x, input.z);
        this.predicted.dashTime = RULES.dashDuration;
        this.predicted.dashCd = RULES.dashCooldown;
        this.predicted.dashX = l ? input.x / l : Math.cos(input.angle);
        this.predicted.dashZ = l ? input.z / l : Math.sin(input.angle);
      }
      this.predicted.dashTime = Math.max(
        0,
        this.predicted.dashTime - 1 / RULES.tick,
      );
      this.predicted.dashCd = Math.max(
        0,
        this.predicted.dashCd - 1 / RULES.tick,
      );
      moveBody(this.predicted, input, 1 / RULES.tick, this.obstacles);
      this.predicted.angle = input.angle;
    }
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
    return {
      ...last.state,
      players: b.state.players.map((p) => {
        if (p.id === this.id && this.predicted)
          return {
            ...p,
            x: this.predicted.x,
            z: this.predicted.z,
            angle: this.predicted.angle,
          };
        const prev = old.get(p.id);
        if (!prev || !p.alive) return p;
        const da = Math.atan2(
          Math.sin(p.angle - prev.angle),
          Math.cos(p.angle - prev.angle),
        );
        return {
          ...p,
          x: prev.x + (p.x - prev.x) * t,
          z: prev.z + (p.z - prev.z) * t,
          angle: prev.angle + da * t,
        };
      }),
      arrows: b.state.arrows.map((p) => {
        const prev = a.state.arrows.find((v) => v.id === p.id);
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
    clearInterval(this.pingTimer);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
  }
}
