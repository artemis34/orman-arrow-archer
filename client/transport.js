import { io } from "socket.io-client";
import { World } from "../shared/world.js";
import { createMode, formatKey } from "../shared/modes.js";
import { practiceBots } from "../shared/online.js";
import { ProjectilePresentation, localProjectiles } from "./projectiles.js";
import { PresentationClock } from "./presentation-clock.js";
import { sendEmote, drainEmotes } from "../shared/emotes.js";
import {
  advanceMovement,
  moveBody,
  cleanInput,
  RULES,
} from "../shared/config.js";
function indexById(entities) {
  const index = new Map();
  for (const entity of entities) index.set(entity.id, entity);
  return index;
}
/** Transport adapters isolate rendering from the authority implementation. */
export class LocalTransport {
  constructor(format = "arena") {
    const key = formatKey(format);
    this.world = new World({
      mode: createMode(key),
      bots: practiceBots(key),
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
    this.world.events.push(...drainEmotes(this.world));
    this.previousState = this.currentState;
    this.currentState = { state: this.world.snapshot(this.id) };
    return this.currentState.state;
  }
  view(fraction = 1) {
    if (!this.currentState) return null;
    const current = this.currentState.state,
      previous = this.previousState?.state;
    let players = current.players;
    // Practice has exact 30 Hz ticks, just like its arrows. Supply continuous
    // positions to the walk/camera animation at display rate; easing a stepped
    // input alone still alternates the visible speed every other 60 Hz frame.
    // Combat metadata and lifecycle transitions always use the latest tick.
    if (
      previous &&
      previous.match?.round === current.match?.round &&
      previous.match?.phase === current.match?.phase &&
      (!current.match || current.match.phase === "playing")
    ) {
      const old = (this.previousState.playerIndex ||= indexById(
          previous.players,
        )),
        t = Number.isNaN(fraction) ? 1 : Math.max(0, Math.min(1, fraction));
      players = current.players.map((p) => {
        const before = old.get(p.id);
        if (
          !before?.alive ||
          !p.alive ||
          p.levelGuard > 0 ||
          Math.hypot(p.x - before.x, p.z - before.z) > 8
        )
          return p;
        return {
          ...p,
          x: before.x + (p.x - before.x) * t,
          z: before.z + (p.z - before.z) * t,
        };
      });
    }
    return {
      ...current,
      players,
      arrows: localProjectiles(this.previousState, current, fraction),
    };
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
  emote(key) {
    sendEmote(this.world, this.id, key);
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
    // A connection is not a zero-latency sample. The diagnostic HUD can show
    // pending/stale measurements separately from actual RTT.
    this.ping = null;
    this.pingMeasuredAt = null;
    this.predicted = null;
    this.previousPrediction = null;
    this.lastInput = null;
    this.inputAt = 0;
    this.correction = { x: 0, z: 0, at: 0 };
    this.projectiles = new ProjectilePresentation();
    this.playerClock = new PresentationClock();
    this.remoteAnchors = new Map();
  }
  acceptState(state) {
    const previousState = this.snapshots.at(-1)?.state;
    const previousMatch = previousState?.match;
    if (
      state.match &&
      previousMatch &&
      (state.match.round !== previousMatch.round ||
        (state.match.phase === "playing" && previousMatch.phase !== "playing"))
    ) {
      this.pending = [];
      this.lastInput = null;
      this.remoteAnchors.clear();
    }
    this.frozen = !!state.match && state.match.phase !== "playing";
    const now = performance.now();
    for (const id of this.remoteAnchors.keys())
      if (!state.players.some((p) => p.id === id && p.alive))
        this.remoteAnchors.delete(id);
    for (const p of state.players) {
      if (p.id === this.id || !p.alive) continue;
      const previousActor = previousState?.players.find(
        (old) => old.id === p.id,
      );
      if (!(p.levelGuard > 0) && previousActor?.alive) continue;
      const anchor = this.remoteAnchors.get(p.id) || {};
      anchor.x = p.x;
      anchor.z = p.z;
      anchor.angle = p.angle;
      anchor.time = Number.isFinite(state.time) ? state.time * 1000 : now;
      this.remoteAnchors.set(p.id, anchor);
    }
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
    const {
      a,
      b,
      fraction: t,
    } = this.playerClock.sample(this.snapshots, performance.now());
    // Accepted snapshots keep stable entity membership. Cache only lookups on
    // their existing eight-entry buffer; timing, prediction and transforms stay
    // unchanged, and shifting a snapshot also releases its index references.
    const old = (a.playerIndex ||= indexById(a.state.players));
    const buffered = (b.playerIndex ||= indexById(b.state.players));
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
        const anchor = this.remoteAnchors.get(p.id);
        if (anchor && !p.levelGuard && p.alive) {
          // Life/protection are live metadata. Warm a new life or hold a
          // protection anchor until the display clock reaches it, so an older
          // snapshot cannot pull a released/respawned actor backward.
          if (this.playerClock.time <= anchor.time)
            return { ...p, x: anchor.x, z: anchor.z, angle: anchor.angle };
          this.remoteAnchors.delete(p.id);
        }
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
      arrows: this.projectiles.view(
        this.snapshots,
        performance.now(),
        this.obstacles,
      ),
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
  emote(key) {
    this.send("emote", key);
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
    this.closed = false;
    this.ping = null;
    this.pingMeasuredAt = null;
    this.pingProbe = null;
    return new Promise((resolve, reject) => {
      let ready = false;
      this.rejectConnect = reject;
      this.socket = this.createSocket(this.url, {
        transports: ["websocket", "polling"],
        timeout: 60000,
        tryAllTransports: true,
        reconnection: false,
      });
      const timer = (this.connectTimer = setTimeout(() => {
        this.close(
          new Error(
            "Sunucu yanıt vermedi. Ücretsiz sunucunun uyanması zaman alabilir.",
          ),
        );
      }, this.connectTimeout));
      this.socket.on("connect", () =>
        this.socket.emit("join", { name, skin, ...options }),
      );
      this.socket.on("welcome", (data) => {
        if (this.closed || ready) return;
        clearTimeout(timer);
        ready = true;
        this.rejectConnect = null;
        this.id = data.id;
        this.obstacles = data.obstacles;
        resolve(data);
        const measure = () => {
          if (this.closed || this.pingProbe) return;
          const probe = { at: performance.now() };
          this.pingProbe = probe;
          this.socket.timeout(3000).emit("latency", (error) => {
            if (this.closed || this.pingProbe !== probe) return;
            this.pingProbe = null;
            const now = performance.now(),
              elapsed = now - probe.at;
            if (
              !error &&
              Number.isFinite(elapsed) &&
              elapsed >= 0 &&
              elapsed <= 3000
            ) {
              this.ping = Math.round(elapsed);
              this.pingMeasuredAt = now;
            }
          });
        };
        measure();
        this.pingTimer = setInterval(measure, 3000);
      });
      this.socket.on("state", (state) => this.acceptState(state));
      this.socket.on("full", () => {
        clearTimeout(timer);
        this.close(new Error("Arena dolu. Biraz sonra tekrar dene."));
      });
      this.socket.on("connect_error", () => {
        if (!ready) {
          clearTimeout(timer);
          this.close(
            new Error(
              "Sunucuya bağlanılamadı. Adresi kontrol et veya antrenmanı seç.",
            ),
          );
        }
      });
      this.socket.on("disconnect", () => {
        if (ready) {
          this.close();
          this.onDisconnect();
        } else {
          clearTimeout(timer);
          this.close(
            new Error("Sunucu bağlantıyı kapattı. Tekrar deneyebilirsin."),
          );
        }
      });
    });
  }
  send(type, data) {
    this.socket.emit(type, data);
  }
  close(error = new Error("Bağlantı durduruldu. Tekrar oynayabilirsin.")) {
    this.closed = true;
    this.pingProbe = null;
    const reject = this.rejectConnect;
    this.rejectConnect = null;
    reject?.(error);
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
  }
}
