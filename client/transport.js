import { io } from "socket.io-client";
import { World } from "../shared/world.js";
import { createMode, FORMATS, formatKey } from "../shared/modes.js";
import {
  advanceMovement,
  moveBody,
  cleanInput,
  RULES,
} from "../shared/config.js";
/** Transport adapters isolate rendering from the authority implementation. */
export class LocalTransport {
  constructor(format = "arena") {
    const key = formatKey(format);
    this.world = new World({
      mode: createMode(key),
      bots: Math.min(7, FORMATS[key].capacity - 1),
    });
    this.id = "local";
    this.online = false;
  }
  async connect(name, skin, options = {}) {
    this.world.addPlayer(this.id, name, skin, false, options);
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
  reroll() {
    this.world.reroll(this.id);
  }
  rematch() {
    this.world.mode.vote?.(this.world, this.id);
  }
  close() {}
}
/** Prediction and interpolation are shared by both online protocols. */
export class NetworkTransport {
  constructor(onState, onDisconnect) {
    this.online = true;
    this.onState = onState;
    this.onDisconnect = onDisconnect;
    this.seq = 0;
    this.pending = [];
    this.snapshots = [];
    this.ping = 0;
    this.predicted = null;
    this.previousPrediction = null;
    this.lastInput = null;
    this.inputAt = 0;
    this.correction = { x: 0, z: 0, at: 0 };
  }
  acceptState(state) {
    const previousMatch = this.snapshots.at(-1)?.state.match;
    if (
      state.match &&
      previousMatch &&
      (state.match.round !== previousMatch.round ||
        (state.match.phase === "playing" && previousMatch.phase !== "playing"))
    ) {
      this.pending = [];
      this.lastInput = null;
    }
    this.frozen = !!state.match && state.match.phase !== "playing";
    const now = performance.now();
    const previous = this.localPose(now);
    const wasGuarded =
      this.snapshots.at(-1)?.state.players.find((p) => p.id === this.id)
        ?.levelGuard > 0;
    this.snapshots.push({ state, at: now });
    while (this.snapshots.length > 8) this.snapshots.shift();
    const me = state.players.find((p) => p.id === this.id);
    if (me) {
      if (!me.alive || (previous && !previous.alive)) {
        this.lastInput = null;
        this.pending = [];
      }
      this.pending = this.pending.filter((i) => i.seq > me.seq);
      this.predicted = { ...me, upgrades: { ...me.upgrades } };
      this.previousPrediction = null;
      if (this.predicted.alive && !this.frozen)
        for (const i of this.pending) {
          this.previousPrediction = { ...this.predicted };
          advanceMovement(this.predicted, i, 1 / RULES.tick, this.obstacles);
        }
      this.correction = { x: 0, z: 0, at: now };
      const next = this.localPose(now);
      if (
        previous?.alive &&
        me.alive &&
        !me.levelGuard &&
        !wasGuarded &&
        Math.hypot(previous.x - next.x, previous.z - next.z) < 3
      ) {
        // Reconcile physics immediately, then decay only the visible offset.
        // Packet arrival must never kick the camera/feet backward mid-stride.
        this.correction.x = previous.x - next.x;
        this.correction.z = previous.z - next.z;
      }
    }
    this.onState(state);
  }
  step(input) {
    input = cleanInput({ ...input, seq: ++this.seq });
    this.send("input", input);
    this.lastInput = input;
    this.inputAt = performance.now();
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    if (this.predicted?.alive && !this.frozen) {
      this.previousPrediction = { ...this.predicted };
      advanceMovement(this.predicted, input, 1 / RULES.tick, this.obstacles);
    }
  }

  localPose(now = performance.now()) {
    if (!this.predicted) return null;
    const p = { ...this.predicted };
    if (!p.alive || p.levelGuard > 0 || this.frozen) return p;
    // Present the latest predicted step at display rate. Interpolating its two
    // endpoints also keeps turns/stops continuous; extrapolating old velocity
    // would jump backward when the next input points in another direction.
    if (this.previousPrediction && this.lastInput) {
      const fraction = Math.max(
        0,
        Math.min(1, ((now - this.inputAt) * RULES.tick) / 1000),
      );
      p.x =
        this.previousPrediction.x +
        (p.x - this.previousPrediction.x) * fraction;
      p.z =
        this.previousPrediction.z +
        (p.z - this.previousPrediction.z) * fraction;
    }
    const decay = Math.exp(-Math.max(0, now - this.correction.at) / 85);
    p.x += this.correction.x * decay;
    p.z += this.correction.z * decay;
    moveBody(p, { x: 0, z: 0 }, 0, this.obstacles);
    return p;
  }

  view() {
    const last = this.snapshots.at(-1);
    if (!last) return null;
    const local = this.localPose();
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
        if (p.id === this.id && local)
          return {
            ...p,
            x: p.levelGuard > 0 ? p.x : local.x,
            z: p.levelGuard > 0 ? p.z : local.z,
            angle: local.angle,
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
  choose(key) {
    this.send("upgrade", key);
  }
  respawn() {
    this.send("respawn");
  }
  reroll() {
    this.send("reroll");
  }
  rematch() {
    this.send("rematch");
  }
}
export class SocketTransport extends NetworkTransport {
  constructor(
    url,
    onState,
    onDisconnect,
    { createSocket = io, connectTimeout = 75000 } = {},
  ) {
    super(onState, onDisconnect);
    this.createSocket = createSocket;
    this.connectTimeout = connectTimeout;
    this.url = url;
  }
  connect(name, skin, options = {}) {
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
      this.socket.on("connect", () =>
        this.socket.emit("join", { name, skin, ...options }),
      );
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
      this.socket.on("state", (state) => this.acceptState(state));
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
  send(type, data) {
    this.socket.emit(type, data);
  }
  close() {
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
  }
}
