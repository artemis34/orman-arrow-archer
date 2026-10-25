import { RANKS, TITLES, rankFor, titleFor } from "../shared/ranking.js";

export function communityUI({
  content,
  status,
  button,
  request,
  profile,
  server,
  token,
  cloudflare,
  activeTab,
}) {
  let generation = 0,
    kind = "solo",
    providers = {};
  const paragraph = (text) => {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  };
  const row = (name, note) => {
    const r = document.createElement("div");
    r.className = "social-row";
    const text = document.createElement("div"),
      strong = document.createElement("b"),
      small = document.createElement("small");
    strong.textContent = name;
    small.textContent = note;
    text.append(strong, small);
    r.append(text);
    return r;
  };
  async function loadProviders() {
    if (!cloudflare) return;
    try {
      const r = await fetch(new URL("/api/auth/providers", server()), {
        signal: AbortSignal.timeout(8000),
      });
      providers = (await r.json()).providers || {};
    } catch {}
    for (const b of document.querySelectorAll("[data-auth-provider]"))
      b.disabled = !providers[b.dataset.authProvider]?.configured;
  }
  function authButtons(target) {
    const box = document.createElement("div");
    box.className = "auth-buttons";
    for (const [provider, label] of [
      ["google", "Google"],
      ["apple", "Apple"],
    ]) {
      const b = button(`${label} ile giriş`, async () => {
        try {
          b.disabled = true;
          const r = await fetch(
            new URL(`/api/auth/${provider}/start`, server()),
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token()}` },
              signal: AbortSignal.timeout(10000),
            },
          );
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "Giriş başlatılamadı.");
          location.assign(data.url);
        } catch (e) {
          status.textContent = e.message;
          b.disabled = false;
        }
      });
      b.dataset.authProvider = provider;
      b.disabled = !providers[provider]?.configured;
      b.title = b.disabled
        ? "Hesap bağlantısı henüz etkin değil"
        : "Hesabını bağla ve farklı cihazda devam et";
      box.append(b);
    }
    target.append(box);
    return box;
  }
  function rankSummary() {
    const p = profile(),
      title = titleFor(p.stats.kills);
    for (const [kind, label] of [
      ["solo", "Solo BR"],
      ["duo", "İkili BR"],
    ]) {
      const rating = p.ratings?.[kind] || { points: 0, matches: 0, wins: 0 },
        rank = rankFor(rating.points);
      const box = row(
        `${label} · ${rank.icon} ${rank.name} · ${rating.points} RP`,
        `${rating.matches} maç · ${rating.wins} galibiyet`,
      );
      box.classList.add("rank-summary");
      content.append(box);
    }
    content.append(
      paragraph(
        `${title.name} · ${p.stats.kills} eleme${title.next ? ` · Sonraki ünvan ${title.next}` : ""}`,
      ),
    );
    content.append(
      paragraph(
        "Solo BR: ilk 10 RP kazanır, 11–32 RP kaybeder. İkili BR: ilk 8 takım kazanır, 9–16 kaybeder. Sırana göre +25 ile −10 RP; bot arttıkça miktar azalır. Puan 0’ın altına inmez. Solo ve ikili dereceleri ayrıdır; düello ve eğitim etkilemez.",
      ),
    );
    const ranks = document.createElement("details"),
      summary = document.createElement("summary");
    summary.textContent = "Rütbeler ve ünvanlar";
    ranks.append(summary);
    for (const [name, min, icon] of RANKS)
      ranks.append(paragraph(`${icon} ${name} · ${min} RP`));
    for (const [name, min] of TITLES)
      ranks.append(paragraph(`${name} · ${min} eleme`));
    content.append(ranks);
    content.append(
      paragraph(
        p.accounts?.length
          ? `Bağlı hesap: ${p.accounts.map((s) => (s === "apple" ? "Apple" : "Google")).join(" · ")}`
          : "Misafir profilin korunur. Hesap bağlantıları etkinleştirildiğinde burada bağlayabilirsin.",
      ),
    );
    authButtons(content);
  }
  async function render(tab) {
    const version = ++generation;
    if (!cloudflare) {
      content.append(
        paragraph(
          "Arkadaşlar ve genel sıralama online Cloudflare sürümünde kullanılabilir.",
        ),
      );
      return;
    }
    const valid = () => version === generation && activeTab() === tab;
    content.append(paragraph("Yükleniyor…"));
    try {
      if (tab === "friends") {
        const data = await request("friends");
        if (!valid()) return;
        content.replaceChildren();
        const p = {
            ...profile(),
            socialCode: data.code || profile().socialCode,
          },
          code = row(
            "Arkadaş kodun",
            p.socialCode?.match(/.{1,4}/g)?.join("-") || "—",
          );
        code.append(
          button("Kopyala", async () => {
            try {
              await navigator.clipboard.writeText(p.socialCode);
              status.textContent = "Arkadaş kodu kopyalandı.";
            } catch {
              status.textContent = `Kodun: ${p.socialCode}`;
            }
          }),
        );
        content.append(code);
        const form = document.createElement("form");
        form.className = "social-form";
        const input = document.createElement("input");
        input.placeholder = "Arkadaş kodu";
        input.maxLength = 14;
        input.setAttribute("aria-label", "Arkadaş kodu");
        // Touch actions suppress compatibility clicks. Explicit submission
        // works on Safari too, without a second native click submitting twice.
        const send = button("İstek gönder", () => form.requestSubmit());
        send.type = "button";
        form.append(input, send);
        form.onsubmit = async (e) => {
          e.preventDefault();
          if (send.disabled) return;
          send.disabled = true;
          try {
            await request("friends/request", { target: input.value });
            status.textContent = "Arkadaş isteği gönderildi.";
            await render(tab);
          } catch (e) {
            status.textContent = e.message;
          } finally {
            send.disabled = false;
          }
        };
        content.append(form);
        const action = (label, path, target) =>
          button(label, async () => {
            try {
              await request(`friends/${path}`, { target });
              await render(tab);
            } catch (e) {
              status.textContent = e.message;
            }
          });
        if (
          !data.friends.length &&
          !data.incoming.length &&
          !data.outgoing.length
        )
          content.append(
            paragraph("Kodunu paylaş; istek onaylandığında arkadaş olursunuz."),
          );
        for (const person of data.incoming) {
          const r = row(person.name, "Gelen istek");
          r.append(
            action("Kabul", "accept", person.code),
            action("Reddet", "decline", person.code),
          );
          content.append(r);
        }
        for (const person of data.outgoing) {
          const r = row(person.name, "Onay bekleniyor");
          r.append(action("İptal", "remove", person.code));
          content.append(r);
        }
        for (const person of data.friends) {
          const r = row(
            person.name,
            `${person.rank.name} · ${person.title.name}`,
          );
          r.append(
            button("Davet", async () => {
              const room = `dost-${crypto.randomUUID().slice(0, 8)}`,
                url = new URL(location.origin + location.pathname);
              url.searchParams.set("room", room);
              url.searchParams.set("format", "arena");
              try {
                await navigator.clipboard.writeText(url.href);
                status.textContent =
                  "Davet bağlantısı kopyalandı. Arkadaşınla paylaş; ikiniz de bu bağlantıyı açın.";
              } catch {
                status.textContent = url.href;
              }
            }),
            action("Çıkar", "remove", person.code),
          );
          content.append(r);
        }
      } else {
        const r = await fetch(
          new URL(`/api/leaderboard?kind=${kind}`, server()),
          { signal: AbortSignal.timeout(8000) },
        );
        if (!r.ok) throw new Error("Sıralama şu anda yüklenemedi.");
        const data = await r.json();
        if (!valid()) return;
        content.replaceChildren();
        const filters = document.createElement("div");
        filters.className = "collection-slots";
        for (const [key, label] of [
          ["solo", "Solo BR"],
          ["duo", "İkili BR"],
          ["kills", "Genel elemeler"],
        ]) {
          const b = button(label, () => {
            kind = key;
            render(tab);
          });
          b.setAttribute("aria-pressed", String(kind === key));
          filters.append(b);
        }
        content.append(filters);
        content.append(
          paragraph(
            kind !== "kills"
              ? "Herkes Tohum ve 0 RP ile başlar. Solo ve ikili sıralamaları ayrı tutulur."
              : "Online maçlarda sunucunun doğruladığı toplam elemeler. Antrenman sayılmaz.",
          ),
        );
        if (!data.entries.length)
          content.append(
            paragraph("Henüz sıralama kaydı yok. İlk izi sen bırak."),
          );
        data.entries.forEach((p, i) =>
          content.append(
            row(
              `${i + 1}. ${p.name}`,
              `${p.rank.name} · ${p.title.name} · ${kind !== "kills" ? `${p.points} RP` : `${p.kills} eleme`}`,
            ),
          ),
        );
      }
    } catch (e) {
      if (valid()) {
        content.replaceChildren(paragraph(e.message));
        content.append(button("Tekrar dene", () => render(tab)));
      }
    }
  }
  return { render, rankSummary, authButtons, loadProviders };
}
