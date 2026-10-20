import { preferences } from "./preferences.js";
import {
  CATALOG,
  ACHIEVEMENTS,
  newProfile,
  validToken,
} from "../shared/profile.js";
import { UPGRADES } from "../shared/config.js";
import { bindAction } from "./ui.js";
import { cosmeticIcon } from "./cosmetic-icons.js";
const labels = {
  bow: "Yay",
  cape: "Pelerin",
  hood: "Başlık",
  trail: "Ok izi",
  spawn: "Doğuş",
  frame: "Çerçeve",
  pose: "Zafer pozu",
};
export function setupProgression({ cloudflare, server, onSettings }) {
  let token = preferences.get("wildbow-profile-key"),
    profile = newProfile(),
    connected = false,
    busy = false;
  if (!validToken(token)) {
    token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    preferences.set("wildbow-profile-key", token);
  }
  const root = document.getElementById("collection");
  const content = root.querySelector(".collection-content");
  const status = root.querySelector(".collection-status");
  let tab = "looks",
    slot = "bow",
    returnFocus = null;
  const button = (label, action, className = "") => {
    const b = document.createElement("button");
    b.textContent = label;
    b.className = className;
    bindAction(b, action);
    return b;
  };
  async function request(action = "", data) {
    const response = await fetch(
      new URL(`/api/profile${action ? "/" + action : ""}`, server()),
      {
        method: data ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(data ? { "Content-Type": "application/json" } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
        signal: AbortSignal.timeout(8000),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Profil şu anda yüklenemedi.");
    apply(result.profile);
    connected = true;
    return result;
  }
  function apply(next) {
    if (!next?.stats || !Array.isArray(next.owned)) return;
    profile = next;
    document.getElementById("collection-balance").textContent =
      `◇ ${profile.coins}`;
    if (!root.classList.contains("hidden")) render();
  }
  async function refresh() {
    if (!cloudflare) return;
    try {
      await request();
      status.textContent = "Online maç tamamla, yaprak kazan, tarzını oluştur.";
    } catch {
      connected = false;
      status.textContent =
        "Profil bağlantısı kurulamadı. Oynayabilir ve tekrar deneyebilirsin.";
    }
    render();
  }
  function close() {
    root.classList.add("hidden");
    returnFocus?.focus();
  }
  function render() {
    content.replaceChildren();
    for (const b of root.querySelectorAll("[data-tab]"))
      b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    if (tab === "looks") {
      const filter = document.createElement("div");
      filter.className = "collection-slots";
      for (const [key, label] of Object.entries(labels)) {
        const b = button(label, () => {
          slot = key;
          render();
        });
        b.setAttribute("aria-pressed", String(slot === key));
        filter.append(b);
      }
      content.append(filter);
      const preview = document.createElement("div");
      preview.className = "gear-preview";
      const equipped = CATALOG.filter(
        (item) => profile.equipped[item.slot] === item.id,
      );
      preview.style.setProperty(
        "--cape-color",
        CATALOG.find((p) => p.id === profile.equipped.cape)?.color || "#244b42",
      );
      preview.style.setProperty(
        "--bow-color",
        CATALOG.find((p) => p.id === profile.equipped.bow)?.color || "#e7bf79",
      );
      const avatar = document.createElement("span");
      avatar.className = "gear-avatar";
      avatar.append(cosmeticIcon("bow"));
      avatar.setAttribute("aria-hidden", "true");
      const caption = document.createElement("p");
      caption.textContent = equipped
        .filter((p) => ["bow", "cape", "hood"].includes(p.slot))
        .map((p) => p.name)
        .join(" · ");
      preview.append(avatar, caption);
      content.append(preview);
      const grid = document.createElement("div");
      grid.className = "cosmetic-grid";
      for (const item of CATALOG.filter((p) => p.slot === slot)) {
        const owned = profile.owned.includes(item.id),
          worn = profile.equipped[slot] === item.id;
        const card = document.createElement("article");
        card.className = "cosmetic-card" + (worn ? " equipped" : "");
        card.style.setProperty("--item-color", item.color);
        const sample = document.createElement("span");
        sample.className = `cosmetic-sample sample-${slot}`;
        sample.append(cosmeticIcon(slot));
        const name = document.createElement("b");
        name.textContent = item.name;
        const b = button(
          worn ? "Kuşanıldı" : owned ? "Kuşan" : `◇ ${item.price} · Aç`,
          async () => {
            if (busy || !connected) return;
            busy = true;
            b.disabled = true;
            try {
              await request(owned ? "equip" : "purchase", { id: item.id });
              status.textContent = owned
                ? "Görünüşün sonraki maç için hazır."
                : "Koleksiyonuna eklendi. Kuşanarak kullanabilirsin.";
            } catch (error) {
              status.textContent = error.message;
            } finally {
              busy = false;
              render();
            }
          },
        );
        b.disabled = worn || !connected || busy;
        card.append(sample, name, b);
        grid.append(card);
      }
      content.append(grid);
    } else if (tab === "profile") {
      const stats = document.createElement("div");
      stats.className = "profile-stats";
      stats.style.borderColor =
        CATALOG.find((p) => p.id === profile.equipped.frame)?.color ||
        "#bde08d";
      for (const [label, value] of [
        ["Maç", profile.stats.matches],
        ["Eleme", profile.stats.kills],
        ["Asist", profile.stats.assists],
        ["Zafer", profile.stats.wins],
      ]) {
        const p = document.createElement("p");
        p.textContent = `${value} ${label}`;
        stats.append(p);
      }
      content.append(stats);
      for (const a of ACHIEVEMENTS) {
        const row = document.createElement("p");
        row.className = "achievement";
        row.textContent = `${profile.achievements.includes(a.id) ? "✓" : "◇"} ${a.name} · ${a.text} (${Math.min(a.value, profile.stats[a.stat])}/${a.value})`;
        content.append(row);
      }
      const note = document.createElement("p");
      note.textContent =
        "Misafir profilin bu tarayıcıda hatırlanır. Başka cihazda devam etmek için profil yedeğini aktar. Yedek, profiline erişim sağlar; kendin için sakla.";
      content.append(
        note,
        button("Profil yedeğini indir", () => {
          const url = URL.createObjectURL(
            new Blob([JSON.stringify({ wildbowProfile: 1, key: token })], {
              type: "application/json",
            }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "wildbow-profil.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
      );
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "application/json";
      file.setAttribute("aria-label", "Profil yedeğini yükle");
      file.addEventListener("change", async () => {
        try {
          if (!file.files[0] || file.files[0].size > 4096)
            throw new Error("Profil yedeği geçersiz.");
          const data = JSON.parse(await file.files[0].text());
          if (!validToken(data.key)) throw new Error("Profil yedeği geçersiz.");
          token = data.key;
          preferences.set("wildbow-profile-key", token);
          await refresh();
        } catch (error) {
          status.textContent = error.message;
        }
      });
      content.append(file);
    } else if (tab === "skills") {
      const note = document.createElement("p");
      note.textContent =
        "Keskin nişancı: uzak avcı + çevik yay. Alan kontrolü: çatal + zincir. Takipçi: buz + rüzgâr. Kombinasyonlar ek gizli hasar vermez.";
      content.append(note);
      for (const u of Object.values(UPGRADES)) {
        const row = document.createElement("p");
        row.className = "achievement";
        row.textContent = `${u.icon} ${u.name} · ${u.description}`;
        content.append(row);
      }
    } else {
      for (const [key, label, choices, fallback] of [
        [
          "quality",
          "Görüntü",
          [
            ["low", "Pil tasarrufu"],
            ["balanced", "Dengeli"],
            ["high", "Yüksek"],
          ],
          "balanced",
        ],
        [
          "stick",
          "Joystick boyutu",
          [
            ["small", "Küçük"],
            ["normal", "Normal"],
            ["large", "Büyük"],
          ],
          "normal",
        ],
        [
          "hand",
          "Klasik joystick yerleşimi",
          [
            ["right", "Hareket solda"],
            ["left", "Hareket sağda"],
          ],
          "right",
        ],
        [
          "haptics",
          "Titreşim",
          [
            ["true", "Açık"],
            ["false", "Kapalı"],
          ],
          "true",
        ],
      ]) {
        const row = document.createElement("label");
        row.textContent = label;
        const select = document.createElement("select");
        for (const [value, name] of choices) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = name;
          select.append(option);
        }
        select.value = preferences.get(`wildbow-${key}`) || fallback;
        select.addEventListener("change", () => {
          preferences.set(`wildbow-${key}`, select.value);
          onSettings();
        });
        row.append(select);
        content.append(row);
      }
    }
  }
  bindAction(document.getElementById("collection-open"), () => {
    returnFocus = document.activeElement;
    root.classList.remove("hidden");
    render();
    document.getElementById("collection-close").focus();
    refresh();
  });
  bindAction(document.getElementById("collection-close"), close);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key !== "Tab") return;
    const elements = [
      ...root.querySelectorAll("button:not(:disabled),select,input"),
    ];
    const first = elements[0],
      last = elements.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  for (const b of root.querySelectorAll("[data-tab]"))
    bindAction(b, () => {
      tab = b.dataset.tab;
      render();
    });
  render();
  onSettings();
  return {
    get token() {
      return token;
    },
    get equipped() {
      return profile.equipped;
    },
    apply,
    refresh,
  };
}
