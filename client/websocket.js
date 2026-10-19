import { NetworkTransport } from "./transport.js";
import { roomCode } from "../shared/online.js";

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
    } = {},
  ) {
    super(onState, onDisconnect);
    this.url = url;
    this.room = room;
    this.createWebSocket = createWebSocket;
    this.connectTimeout = connectTimeout;
  }
  connect(name, skin) {
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
      const address = new URL(`/api/rooms/${room}`, this.url);
      address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
      this.ws = this.createWebSocket(address.href);
      this.connectTimer = setTimeout(
        () =>
          fail(
            "Arenaya bağlanılamadı. Tekrar deneyebilir veya antrenmanı seçebilirsin.",
          ),
        this.connectTimeout,
      );
      this.ws.addEventListener("open", () => this.send("join", { name, skin }));
      this.ws.addEventListener("message", (event) => {
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
          resolve(packet.data);
          this.pingTimer = setInterval(() => {
            this.pingAt = performance.now();
            this.send("ping");
          }, 2000);
        } else if (packet.type === "state" && ready)
          this.acceptState(packet.data);
        else if (packet.type === "pong")
          this.ping = Math.round(performance.now() - this.pingAt);
        else if (packet.type === "full" || packet.type === "error") {
          if (!ready)
            fail(
              packet.type === "full"
                ? "Arena dolu. Başka bir oda koduyla katılabilirsin."
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
    });
  }
  send(type, data) {
    if (this.ws?.readyState !== 1) return;
    // Stop an unhealthy connection before buffered input grows without bound.
    if (this.ws.bufferedAmount > 65536) {
      this.ws.close(1000, "connection too slow");
      return;
    }
    this.ws.send(JSON.stringify({ type, data }));
  }
  close() {
    this.closed = true;
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    if (this.ws && this.ws.readyState < 2) this.ws.close(1000, "leaving arena");
  }
}
