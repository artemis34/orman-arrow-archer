const WINDOW_MS = 3000;
const PING_STALE_MS = 15000;

/** Render intervals, before the simulation's dt clamp. Hidden time is reset by the caller. */
export class FrameCadence {
  constructor(windowMs = WINDOW_MS) {
    this.windowMs = windowMs;
    this.reset();
  }
  reset() {
    this.lastAt = null;
    this.samples = [];
  }
  record(now) {
    if (!Number.isFinite(now)) return;
    if (this.lastAt !== null && now < this.lastAt) this.reset();
    if (this.lastAt !== null && now > this.lastAt)
      this.samples.push({ at: now, ms: now - this.lastAt });
    this.lastAt = now;
    this.prune(now);
  }
  prune(now) {
    while (
      this.samples.length &&
      (this.samples[0].at <= now - this.windowMs || this.samples.length > 1024)
    )
      this.samples.shift();
  }
  read(now) {
    this.prune(now);
    if (!this.samples.length) return null;
    const durations = this.samples.map((sample) => sample.ms);
    const total = durations.reduce((sum, ms) => sum + ms, 0);
    durations.sort((a, b) => a - b);
    return {
      fps: (durations.length * 1000) / total,
      p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
      jank: durations.filter((ms) => ms > 50).length,
    };
  }
}

const epochOf = (state) =>
  state.match ? `${state.match.round}:${state.match.phase}` : "arena";

/** Arrival timings and received simulation time are distinct from measured RTT. */
export class NetworkCadence {
  constructor(windowMs = WINDOW_MS) {
    this.windowMs = windowMs;
    this.reset();
  }
  reset() {
    this.transport = null;
    this.latest = null;
    this.epoch = null;
    this.samples = [];
  }
  record(transport, now) {
    if (this.transport !== transport) {
      this.reset();
      this.transport = transport;
    }
    const snapshots = transport?.snapshots;
    const latest = snapshots?.at(-1);
    if (latest && latest !== this.latest) {
      const previousAt = this.latest?.at ?? -Infinity;
      for (const snapshot of snapshots) {
        if (!Number.isFinite(snapshot.at) || snapshot.at <= previousAt)
          continue;
        const epoch = epochOf(snapshot.state);
        if (epoch !== this.epoch) this.samples = [];
        this.epoch = epoch;
        // Retain timings only; full authoritative snapshots can be large.
        this.samples.push({
          at: snapshot.at,
          time: Number.isFinite(snapshot.state.time)
            ? snapshot.state.time * 1000
            : null,
        });
      }
      this.latest = latest;
    }
    while (
      this.samples.length &&
      (this.samples[0].at <= now - this.windowMs || this.samples.length > 256)
    )
      this.samples.shift();
  }
  read(transport, now) {
    if (!transport?.online) return { online: false };
    const pingValid =
      Number.isFinite(transport.ping) &&
      transport.ping >= 0 &&
      Number.isFinite(transport.pingMeasuredAt) &&
      transport.pingMeasuredAt >= 0 &&
      transport.pingMeasuredAt <= now;
    const pingAgeMs = pingValid ? now - transport.pingMeasuredAt : null;
    const ageMs = Number.isFinite(this.latest?.at)
      ? Math.max(0, now - this.latest.at)
      : null;
    const intervals = [],
      steps = [];
    for (let i = 1; i < this.samples.length; i++) {
      const before = this.samples[i - 1],
        after = this.samples[i];
      if (after.at > before.at) intervals.push(after.at - before.at);
      if (
        before.time !== null &&
        after.time !== null &&
        after.time >= before.time
      )
        steps.push(after.time - before.time);
    }
    const elapsed = intervals.reduce((sum, ms) => sum + ms, 0);
    const average = intervals.length ? elapsed / intervals.length : null;
    const first = this.samples[0],
      last = this.samples.at(-1);
    const simulationRatio =
      elapsed >= 300 &&
      first?.time !== null &&
      last?.time !== null &&
      last.time >= first.time
        ? (last.time - first.time) / elapsed
        : null;
    return {
      online: true,
      pingMs: pingValid ? transport.ping : null,
      pingAgeMs,
      pingStale: pingAgeMs !== null && pingAgeMs > PING_STALE_MS,
      ageMs,
      arrivalHz: average > 0 ? 1000 / average : null,
      jitterMs:
        intervals.length > 1
          ? intervals.reduce((sum, ms) => sum + Math.abs(ms - average), 0) /
            intervals.length
          : null,
      maxArrivalGapMs: intervals.length ? Math.max(...intervals) : null,
      serverStepMs: steps.length
        ? steps.reduce((sum, ms) => sum + ms, 0) / steps.length
        : null,
      simulationRatio,
    };
  }
}

const ms = (value) => (value === null ? "—" : `${Math.round(value)} ms`);

export function setupPerformanceMonitor({ parent, enabled = false }) {
  const element = document.createElement("aside");
  element.id = "performance-monitor";
  element.className = "performance-monitor hidden";
  element.setAttribute("aria-label", "Performans ve bağlantı ölçümleri");
  element.setAttribute("aria-live", "off");
  const frameLine = document.createElement("div"),
    networkLine = document.createElement("div"),
    cadenceLine = document.createElement("div"),
    roomLine = document.createElement("div");
  frameLine.id = "performance-frames";
  networkLine.id = "performance-network";
  cadenceLine.id = "performance-cadence";
  roomLine.id = "performance-room";
  frameLine.title =
    "Son 3 saniyedeki çizilen kareler. p95: kare aralıklarının %95'i bu sürede veya altında. Takılma: 50 ms üzerindeki kare aralıkları. GPU süresi değildir.";
  networkLine.title =
    "Ping: tarayıcıdan sunucuya gidip gelen ölçülmüş yanıt süresi; tarayıcıdaki beklemeyi de içerir. Veri yaşı: son durumun bu tarayıcıya ulaşmasından beri geçen süre; tek yönlü ağ gecikmesi değildir.";
  element.append(frameLine, networkLine, cadenceLine, roomLine);
  parent.append(element);
  const frames = new FrameCadence(),
    network = new NetworkCadence();
  let active = false,
    updateAt = 0;
  const reset = () => {
    frames.reset();
    network.reset();
    updateAt = 0;
    frameLine.textContent = "FPS ölçülüyor…";
    networkLine.textContent = "";
    cadenceLine.textContent = "";
    roomLine.textContent = "";
    for (const key of Object.keys(element.dataset)) delete element.dataset[key];
  };
  const setEnabled = (value) => {
    if (active === value) return;
    active = value;
    element.classList.toggle("hidden", !active);
    reset();
  };
  setEnabled(enabled);
  return {
    reset,
    setEnabled,
    frame(now, transport) {
      if (!active) return;
      frames.record(now);
      network.record(transport, now);
      if (now < updateAt) return;
      updateAt = now + 500;
      const frame = frames.read(now),
        connection = network.read(transport, now);
      frameLine.textContent = frame
        ? `${Math.round(frame.fps)} FPS · p95 ${Math.round(frame.p95Ms)} ms · Takılma ${frame.jank}`
        : "FPS ölçülüyor…";
      if (!connection.online) {
        networkLine.textContent = "YEREL · Sunucu bağlantısı yok";
        cadenceLine.textContent = "";
      } else {
        const ping =
          connection.pingMs === null
            ? "Ping ölçülüyor…"
            : connection.pingStale
              ? `Ping eski (${ms(connection.pingMs)})`
              : `Ping ${ms(connection.pingMs)}`;
        networkLine.textContent = `${ping} · Veri yaşı ${ms(connection.ageMs)}`;
        cadenceLine.textContent = `Veri ${connection.arrivalHz === null ? "—" : connection.arrivalHz.toFixed(1)}/sn · Akış ${connection.simulationRatio === null ? "—" : connection.simulationRatio.toFixed(2) + "×"} · Jitter ${ms(connection.jitterMs)}`;
        cadenceLine.title = `Akış: alınan sunucu zamanının yerel süreye oranı; 1,00× gerçek zamanla eşleşir. Ağ ve tarayıcı beklemeleri sonucu etkiler. Jitter: durumların geliş aralığındaki ortalama sapma. En uzun geliş aralığı: ${ms(connection.maxArrivalGapMs)}. Sunucu zaman adımı: ${ms(connection.serverStepMs)}.`;
      }
      const metrics = {
        fps: frame?.fps,
        p95Ms: frame?.p95Ms,
        jank: frame?.jank,
        pingMs: connection.pingMs,
        pingAgeMs: connection.pingAgeMs,
        snapshotAgeMs: connection.ageMs,
        arrivalHz: connection.arrivalHz,
        maxArrivalGapMs: connection.maxArrivalGapMs,
        serverStepMs: connection.serverStepMs,
        simulationRatio: connection.simulationRatio,
        jitterMs: connection.jitterMs,
      };
      const room =
        connection.online && typeof transport?.room === "string"
          ? transport.room
          : "";
      roomLine.textContent = room ? `Oda ${room}` : "";
      element.dataset.room = room;
      for (const [key, value] of Object.entries(metrics))
        element.dataset[key] = Number.isFinite(value) ? String(value) : "";
    },
  };
}
