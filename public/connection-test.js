const labels = {
  edge: "Cloudflare girişi",
  regional: "Bölgesel test",
  room: "Son oyun odası",
};
export function summarize(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  return {
    count: a.length,
    median: a.length ? a[Math.floor((a.length - 1) * 0.5)] : null,
    p95: a.length ? a[Math.ceil(a.length * 0.95) - 1] : null,
    max: a.length ? a.at(-1) : null,
  };
}
export function diagnose(results) {
  const edge = results.find((r) => r.target === "edge"),
    regional = results.find((r) => r.target === "regional"),
    room = results.find((r) => r.target === "room");
  if (!(edge?.count >= 5) || !(regional?.count >= 5))
    return "Karşılaştırma için yeterli yanıt alınamadı. Sonucu paylaş; aynı ağda yeniden deneyebilirsin.";
  if (room?.count >= 5 && room.median - regional.median > 60)
    return "Son oyun odasına erişim, bölgesel testten belirgin yavaş. Odanın yerleşimi veya iş yükü incelenmeli; bu fark tek başına kesin nedeni kanıtlamaz.";
  if (
    regional.median - edge.median > 60 ||
    (room?.count >= 5 && room.median - edge.median > 60)
  )
    return "Cloudflare girişi ile oda arasında ek gecikme görülüyor. Oda yerleşimi, iç ağ rotası ve işlem kuyruğu araştırılmalı.";
  if (edge.median >= 100 || edge.p95 >= 200)
    return "Cloudflare girişine ulaşırken de gecikme yüksek veya değişken. Wi‑Fi / mobil veri ve alternatif sunucu aynı telefondan karşılaştırılmalı.";
  return "Bu kısa testte belirgin bir oda gecikmesi ayrışmadı. Maç içi takılma sürüyorsa yoğun veri akışı ve anlık sıçramalar ayrıca incelenmeli.";
}

/** Exactly one outstanding ID: a late reply cannot become the next ping's RTT. */
export async function probeSocket(
  address,
  { signal, samples = 20, interval = 400 } = {},
) {
  const ws = new WebSocket(address),
    values = [];
  let pending = null,
    ready = false,
    closed = false,
    openTimer,
    resolveOpen,
    rejectOpen,
    timeouts = 0,
    context = null;
  const endPending = (value) => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const resolve = pending.resolve;
    pending = null;
    resolve(value);
  };
  const stop = () => {
    if (closed) return;
    closed = true;
    clearTimeout(openTimer);
    endPending(null);
    rejectOpen?.(
      new Error(signal?.aborted ? "Ölçüm iptal edildi" : "Bağlantı kapandı"),
    );
    try {
      ws.close(1000, "test complete");
    } catch {}
  };
  const opening = new Promise((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
    openTimer = setTimeout(() => {
      reject(new Error("Bağlantı zaman aşımı"));
      stop();
    }, 8000);
  });
  ws.addEventListener("message", ({ data }) => {
    try {
      const packet = JSON.parse(data);
      if (packet.type === "ready" && !ready) {
        ready = true;
        context = packet.context || null;
        clearTimeout(openTimer);
        rejectOpen = null;
        resolveOpen();
      } else if (packet.type === "probe" && pending?.id === packet.id)
        endPending(performance.now() - pending.at);
    } catch {}
  });
  ws.addEventListener("close", stop, { once: true });
  ws.addEventListener("error", stop, { once: true });
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  try {
    await opening;
    const deadline = performance.now() + 22000;
    for (
      let id = 0;
      id < samples &&
      !closed &&
      !signal?.aborted &&
      performance.now() < deadline;
      id++
    ) {
      const at = performance.now();
      const value = await new Promise((resolve) => {
        pending = {
          id,
          at,
          resolve,
          timer: setTimeout(() => endPending(null), 2500),
        };
        try {
          ws.send(JSON.stringify({ type: "probe", id }));
        } catch {
          stop();
        }
      });
      if (value === null) timeouts++;
      else values.push(value);
      if (!closed && !signal?.aborted)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, interval - (performance.now() - at))),
        );
    }
    return {
      ...summarize(values),
      expected: samples,
      timeouts,
      incomplete: values.length < samples,
      context,
    };
  } finally {
    signal?.removeEventListener("abort", stop);
    stop();
  }
}

async function boot() {
  const $ = (id) => document.getElementById(id),
    start = $("start");
  let controller = null;
  const cancel = () => controller?.abort();
  addEventListener("pagehide", cancel);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancel();
  });
  const ms = (v) => (Number.isFinite(v) ? `${Math.round(v)} ms` : "—");
  start.addEventListener("click", async () => {
    if (controller) {
      cancel();
      return;
    }
    const run = (controller = new AbortController());
    let infoTimer;
    start.textContent = "İptal et";
    $("results").classList.add("hidden");
    $("status").textContent = "Bağlantılar ölçülüyor… Bu sayfayı açık tut.";
    $("rows").replaceChildren();
    try {
      infoTimer = setTimeout(() => run.abort(), 8000);
      const response = await fetch("/api/connection-info", {
        cache: "no-store",
        signal: run.signal,
      });
      if (!response.ok) throw new Error("Bağlantı bilgisi alınamadı");
      const info = await response.json();
      clearTimeout(infoTimer);
      if (info.version !== 1)
        throw new Error("Bağlantı testi sürümü henüz hazır değil");
      const room = new URL(location.href).searchParams.get("room");
      const targets = ["edge", "regional"];
      if (room && /^[a-z0-9][a-z0-9-]{2,23}$/.test(room)) targets.push("room");
      $("location").textContent =
        `Ülke ${info.country || "—"} · Cloudflare girişi ${info.ingress || "—"} · Bölge hedefi ${info.region || "varsayılan"}${room ? ` · Oda ${room}` : " · Son oda belirtilmedi"}`;
      const results = await Promise.all(
        targets.map(async (target) => {
          const url = new URL("/api/connection-probe", location.href);
          url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
          url.searchParams.set("target", target);
          if (target === "room") url.searchParams.set("room", room);
          try {
            return {
              target,
              ...(await probeSocket(url.href, { signal: run.signal })),
            };
          } catch (e) {
            return {
              target,
              count: 0,
              median: null,
              p95: null,
              error: e.message,
            };
          }
        }),
      );
      if (run.signal.aborted)
        throw new Error(
          "Ölçüm iptal edildi; sayfayı açık tutarak yeniden başlat.",
        );
      const lines = [
        "Wildbow bağlantı testi",
        new Date().toISOString(),
        $("location").textContent,
      ];
      for (const r of results) {
        const tr = document.createElement("tr");
        for (const value of [
          labels[r.target],
          ms(r.median),
          ms(r.p95),
          `${r.count}/20`,
        ]) {
          const td = document.createElement("td");
          td.textContent = value;
          tr.append(td);
        }
        $("rows").append(tr);
        lines.push(
          `${labels[r.target]}: medyan ${ms(r.median)}, p95 ${ms(r.p95)}, yanıt ${r.count}/20${r.error ? `, ${r.error}` : ""}`,
        );
        if (r.context)
          lines.push(
            `${labels[r.target]} durumu: ${r.context.humans} oyuncu, simülasyon ${r.context.ticking ? "açık" : "kapalı"}`,
          );
      }
      const diagnosis = diagnose(results);
      $("diagnosis").textContent = diagnosis;
      lines.push(
        diagnosis,
        "Kısa, küçük WebSocket mesajları; giriş noktası DO sunucu şehrini göstermez.",
      );
      $("report").value = lines.join("\n");
      $("results").classList.remove("hidden");
      $("status").textContent =
        "Ölçüm tamamlandı. Sonucu kopyalayıp paylaşabilirsin.";
    } catch (e) {
      $("status").textContent = run.signal.aborted
        ? "Ölçüm durduruldu. Sayfayı açık tutarak yeniden deneyebilirsin."
        : `Ölçüm tamamlanamadı: ${e.message}`;
    } finally {
      clearTimeout(infoTimer);
      if (controller === run) controller = null;
      start.textContent = "Yeniden test et";
    }
  });
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("report").value);
      $("status").textContent = "Sonuç kopyalandı.";
    } catch {
      $("report").focus();
      $("report").select();
      $("status").textContent = "Metni seçip kopyalayabilirsin.";
    }
  });
}
if (
  typeof document !== "undefined" &&
  document.querySelector("[data-connection-version]")
)
  boot();
