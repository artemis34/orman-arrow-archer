import { NetworkTransport } from "./transport.js";
import { roomCode } from "../shared/online.js";
import { PROTOCOL, SnapshotDecoder, encodeInputs } from "../shared/protocol.js";

/** Native WebSocket adapter for a Cloudflare authoritative arena. */
export class WebSocketTransport extends NetworkTransport {
  constructor(
    url,
    onState,
    onDisconnect,
    {
      room = "arena",
      createWebSocket = (address) => new WebSocket(address),
      connectTimeout = 12000,
      matchmake = false,
      fetcher = (...args) => fetch(...args),
      viewRadius = 34,
      format = "arena",
    } = {},
  ) {
    super(onState, onDisconnect);
    this.url = url;
    this.room = room;
    this.createWebSocket = createWebSocket;
    this.connectTimeout = connectTimeout;
    this.matchmake = matchmake;
    this.fetcher = fetcher;
    this.viewRadius = viewRadius;
    this.format = format;
    this.decoder = new SnapshotDecoder();
    this.inputBatch = [];
  }
  connect(name, skin, options = {}) {
    return new Promise((resolve, reject) => {
      const room = roomCode(this.room);
      if (!room)
        return reject(
          new Error("Oda kodu 3–24 harf, rakam veya tire içermeli."),
        );
      let ready = false;
      const fail = (message) => {
        this.close();
        reject(new Error(message));
      };
      this.abort = new AbortController();
      this.connectTimer = setTimeout(
        () =>
          fail(
            "Arenaya bağlanılamadı. Tekrar deneyebilir veya antrenmanı seçebilirsin.",
          ),
        this.connectTimeout,
      );
      const open = async () => {
        let selectedRoom = room,
          ticket = null;
        if (this.matchmake) {
          const response = await this.fetcher(
            new URL(
              `/api/matchmake${this.format !== "arena" ? `?format=${encodeURIComponent(this.format)}` : ""}`,
              this.url,
            ),
            { signal: this.abort.signal },
          );
          if (!response.ok)
            throw new Error("Uygun arena bulunamadı. Biraz sonra tekrar dene.");
          const allocation = await response.json();
          selectedRoom = roomCode(allocation.room);
          ticket = allocation.ticket;
          if (!selectedRoom || typeof ticket !== "string")
            throw new Error("Arena yanıtı geçersiz.");
        }
        if (this.closed) return;
        const address = new URL(`/api/rooms/${selectedRoom}`, this.url);
        if (this.format !== "arena")
          address.searchParams.set("format", this.format);
        if (ticket) address.searchParams.set("ticket", ticket);
        address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
        this.ws = this.createWebSocket(address.href);
        this.ws.binaryType = "arraybuffer";
        this.ws.addEventListener("open", () =>
          this.send("join", {
            name,
            skin,
            protocol: PROTOCOL,
            viewRadius: this.viewRadius,
            ...(this.format !== "arena" ? { format: this.format } : {}),
            ...options,
          }),
        );
        this.ws.addEventListener("message", (event) => {
          if (typeof event.data !== "string") {
            if (!ready) return;
            try {
              this.acceptState(this.decoder.decode(event.data));
            } catch {
              this.ws.close(1002, "invalid state");
            }
            return;
          }
          let packet;
          try {
            packet = JSON.parse(event.data);
          } catch {
            return;
          }
          if (!packet || typeof packet !== "object") return;
          if (packet.type === "welcome" && !ready) {
            ready = true;
            clearTimeout(this.connectTimer);
            this.id = packet.data.id;
            this.obstacles = packet.data.obstacles;
            this.room = packet.data.room;
            this.binary = packet.data.protocol === PROTOCOL;
            resolve(packet.data);
            this.pingTimer = setInterval(() => {
              this.pingAt = performance.now();
              this.send("ping");
            }, 10000);
          } else if (packet.type === "state" && ready)
            this.acceptState(packet.data);
          else if (packet.type === "profile") this.onProfile?.(packet.data);
          else if (packet.type === "pong")
            this.ping = Math.round(performance.now() - this.pingAt);
          else if (packet.type === "full" || packet.type === "error") {
            if (!ready)
              fail(
                packet.type === "full"
                  ? "Arena dolu. Başka bir oda koduyla katılabilirsin."
                  : typeof packet.data?.message === "string"
                    ? packet.data.message.slice(0, 140)
                    : "Arenaya bağlanılamadı. Tekrar dene.",
              );
          }
        });
        this.ws.addEventListener("error", () => {
          if (!ready && !this.closed)
            fail(
              "Sunucuya bağlanılamadı. Tekrar deneyebilir veya antrenmanı seçebilirsin.",
            );
        });
        this.ws.addEventListener("close", () => {
          if (this.closed) return;
          if (ready) {
            this.close();
            this.onDisconnect();
          } else fail("Sunucu bağlantıyı kapattı. Tekrar deneyebilirsin.");
        });
      };
      open().catch((error) => {
        if (!this.closed) fail(error.message);
      });
    });
  }
  send(type, data) {
    if (this.ws?.readyState !== 1) return;
    // Stop an unhealthy connection before buffered input grows without bound.
    if (this.ws.bufferedAmount > 65536) {
      this.ws.close(1000, "connection too slow");
      return;
    }
    if (type === "input" && this.binary) {
      const previous = this.lastWireInput;
      this.inputBatch.push(data);
      this.lastWireInput = data;
      // Predict at 30 Hz; send two ordered authority frames in one 15 Hz packet.
      // Press/release, stopping and explicit target selection are sent immediately.
      const urgent =
        !previous ||
        data.dash ||
        data.heal ||
        data.quickShot ||
        data.cancelShot ||
        data.lockTarget !== undefined ||
        data.charge !== previous.charge ||
        data.autoFire !== previous.autoFire ||
        (!(data.x || data.z) && (previous.x || previous.z));
      if (urgent || this.inputBatch.length >= 2) {
        this.ws.send(encodeInputs(this.inputBatch));
        this.inputBatch = [];
      }
    } else this.ws.send(JSON.stringify({ type, data }));
  }
  updateView(radius) {
    this.viewRadius = radius;
    this.send("view", radius);
  }
  close() {
    this.closed = true;
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    this.abort?.abort();
    this.inputBatch.length = 0;
    if (this.ws && this.ws.readyState < 2) this.ws.close(1000, "leaving arena");
  }
}
