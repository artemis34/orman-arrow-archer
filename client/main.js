import "@fontsource/manrope/latin-800.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-ext-800.css";
import "@fontsource/manrope/latin-ext-700.css";
import "@fontsource/dm-sans/latin-ext-400.css";
import "@fontsource/dm-sans/latin-ext-500.css";
import "@fontsource/dm-sans/latin-ext-700.css";
import "./style.css";
import { ArenaScene } from "./scene.js";
import { AudioEngine } from "./audio.js";
import { Controls } from "./controls.js";
import { LocalTransport, SocketTransport } from "./transport.js";
import { World } from "../shared/world.js";
import { SKINS, UPGRADES, RULES } from "../shared/config.js";
const $ = (id) => document.getElementById(id),
  show = (id, visible) => $(id).classList.toggle("hidden", !visible),
  text = (id, value) => {
    if ($(id).textContent !== String(value)) $(id).textContent = value;
  };
let scene;
try {
  scene = new ArenaScene($("arena"));
} catch (err) {
  $("loading").textContent =
    "WebGL başlatılamadı. Donanım hızlandırmayı açıp güncel bir tarayıcıyla tekrar dene.";
  throw err;
}
const audio = new AudioEngine(),
  controls = new Controls($("arena"), scene, audio),
  atHome = new World({ bots: 7 });
scene.setMap(atHome.obstacles);
let playing = false,
  transport = null,
  state = atHome.snapshot(),
  mode = "practice",
  skin = 0,
  myId = null,
  lastTime = performance.now(),
  accumulator = 0,
  hudAt = 0,
  choicesKey = "",
  lastLevel = 1,
  toastTimer,
  joining = false;
const initialServer =
  new URLSearchParams(location.search).get("server") ||
  localStorage.getItem("wildbow-server") ||
  import.meta.env.VITE_SERVER_URL ||
  (["localhost", "127.0.0.1"].includes(location.hostname) ||
  location.hostname.endsWith(".onrender.com")
    ? location.origin
    : "");
$("server-url").value = initialServer;
$("player-name").value = localStorage.getItem("wildbow-name") || "Gezgin";
for (const [i, s] of SKINS.entries()) {
  const b = document.createElement("button");
  b.className = "skin" + (i === skin ? " selected" : "");
  b.style.setProperty("--skin", "#" + s.body.toString(16));
  b.setAttribute("aria-label", s.name);
  b.setAttribute("aria-pressed", String(i === skin));
  b.addEventListener("click", () => {
    skin = i;
    for (const [j, e] of [...$("skins").children].entries()) {
      e.classList.toggle("selected", j === i);
      e.setAttribute("aria-pressed", String(j === i));
    }
  });
  $("skins").append(b);
}
function setMode(next) {
  mode = next;
  $("practice-mode").classList.toggle("selected", mode === "practice");
  $("online-mode").classList.toggle("selected", mode === "online");
  show("server-field", mode === "online");
  text(
    "join-status",
    mode === "practice"
      ? "Botlarla anında oyna · Hesap gerekmez"
      : "Gerçek oyuncular · Sunucu bağlantısı gerekir",
  );
  text(
    "server-label",
    mode === "practice"
      ? "Yerel arena • 7 bot rakip"
      : "Paylaşılan çevrimiçi arena",
  );
}
$("practice-mode").onclick = () => setMode("practice");
$("online-mode").onclick = () => setMode("online");
function syncSound() {
  for (const b of document.querySelectorAll(".sound-button")) {
    b.textContent = audio.enabled ? "♫" : "♩";
    b.setAttribute("aria-pressed", String(audio.enabled));
    b.title = audio.enabled ? "Sesi kapat" : "Sesi aç";
  }
}
for (const b of document.querySelectorAll(".sound-button"))
  b.onclick = () => {
    audio.toggle();
    syncSound();
  };
syncSound();
let focusBeforeHelp = null;
function help(open) {
  if (open) focusBeforeHelp = document.activeElement;
  show("help", open);
  controls.active = playing && !open;
  if (open) {
    controls.reset();
    $("help-close").focus();
  } else focusBeforeHelp?.focus();
}
$("help-open").onclick = () => help(true);
$("game-help").onclick = () => help(true);
$("help-close").onclick = () => help(false);
addEventListener("keydown", (e) => {
  if (e.code === "Escape" && !$("help").classList.contains("hidden"))
    help(false);
  if (
    playing &&
    ["Digit1", "Digit2", "Digit3"].includes(e.code) &&
    !$("upgrades").classList.contains("hidden")
  ) {
    const b = $("upgrade-options").children[Number(e.code.slice(-1)) - 1];
    b?.click();
  }
});
function toast(message) {
  text("toast", message);
  show("toast", true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show("toast", false), 2800);
}
function consume(next) {
  state = next;
  if (!playing) return;
  for (const e of next.events || []) {
    if (e.type === "kill") {
      const row = document.createElement("div");
      row.className = "kill-entry";
      const b = document.createElement("b");
      b.textContent = e.killer;
      row.append(b, document.createTextNode("  ↗  " + e.name));
      $("kill-feed").prepend(row);
      while ($("kill-feed").children.length > 4)
        $("kill-feed").lastChild.remove();
      setTimeout(() => row.remove(), 5500);
    } else if (e.type === "hit") {
      scene.burst(e.x, e.z, 0xf4c98b, 7);
      if (e.owner === myId || e.target === myId) {
        audio.play("hit");
        if (e.target === myId) navigator.vibrate?.(18);
      }
    } else if (e.type === "shot") {
      if (e.owner === myId) audio.play("shot");
    } else if (e.type === "gem" && e.owner === myId) {
      scene.burst(e.x, e.z, 0xd1f59b, 4);
      audio.play("gem");
    } else if (e.type === "heal") {
      scene.burst(e.x, e.z, 0xa8efa1, 14);
      if (e.owner === myId) {
        audio.play("level");
        toast("Orman nefesi · +25 can");
      }
    } else if (e.type === "dash") {
      scene.burst(e.x, e.z, 0xdbedbc, 6);
      if (e.owner === myId) audio.play("dash");
    }
  }
}
async function join() {
  if (joining) return;
  joining = true;
  $("play").disabled = true;
  audio.unlock();
  const name = $("player-name").value.trim() || "Gezgin";
  localStorage.setItem("wildbow-name", name);
  let candidate;
  try {
    if (mode === "online") {
      let url = $("server-url").value.trim();
      if (!url) throw new Error("Çok oyunculu mod için bir sunucu adresi gir.");
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol))
        throw new Error("Geçerli bir HTTP(S) sunucu adresi gir.");
      if (location.protocol === "https:" && parsed.protocol !== "https:")
        throw new Error("Bu sayfada güvenli bir HTTPS sunucusu gerekiyor.");
      url = parsed.origin;
      localStorage.setItem("wildbow-server", url);
      text("join-status", "Arenaya bağlanılıyor…");
      candidate = new SocketTransport(url, consume, () => {
        leave();
        text(
          "join-status",
          "Bağlantı kesildi. Tekrar katılabilir veya antrenmanı seçebilirsin.",
        );
      });
    } else candidate = new LocalTransport();
    const welcome = await candidate.connect(name, skin);
    transport = candidate;
    myId = welcome.id;
    playing = true;
    controls.active = true;
    controls.reset();
    lastLevel = 1;
    choicesKey = "";
    accumulator = 0;
    state = transport.online ? null : transport.world.snapshot(myId);
    show("lobby", false);
    show("hud", true);
    document.body.classList.add("playing");
    text(
      "mode-label",
      transport.online ? "ÇOK OYUNCULU ARENA" : "ANTRENMAN ARENASI",
    );
    text("connection", transport.online ? "CANLI" : "YEREL");
    toast("Ormana hoş geldin. Kristalleri topla, yayını ger!");
  } catch (error) {
    candidate?.close();
    text("join-status", error.message);
  } finally {
    joining = false;
    $("play").disabled = false;
  }
}
$("play").onclick = join;
$("player-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});
function leave() {
  playing = false;
  controls.active = false;
  controls.reset();
  transport?.close();
  transport = null;
  myId = null;
  state = atHome.snapshot();
  for (const id of ["hud", "death", "upgrades", "help"]) show(id, false);
  show("lobby", true);
  document.body.classList.remove("playing");
  $("kill-feed").replaceChildren();
  text(
    "join-status",
    mode === "practice"
      ? "Botlarla anında oyna · Hesap gerekmez"
      : "Çok oyunculu arenaya yeniden katılabilirsin.",
  );
}
$("exit").onclick = leave;
$("back-lobby").onclick = leave;
$("respawn").onclick = () => {
  transport?.respawn();
  controls.reset();
};
function updateHud(current) {
  const me = current?.players.find((p) => p.id === myId);
  if (!me) return;
  text("hud-name", me.name);
  text("level", me.level);
  text("kills", me.kills);
  text("health-text", `${Math.ceil(me.hp)} / ${me.maxHp}`);
  $("health-fill").style.width = `${(me.hp / me.maxHp) * 100}%`;
  $("xp-fill").style.width = `${(me.xp / (me.level * 55)) * 100}%`;
  text("xp-text", `${me.xp} / ${me.level * 55}`);
  text("dash-time", me.dashCd > 0.05 ? `${me.dashCd.toFixed(1)}s` : "HAZIR");
  $("dash").classList.toggle("cooldown", me.dashCd > 0.05);
  text("heal-time", me.healCd > 0.05 ? `${me.healCd.toFixed(0)}s` : "+25 CAN");
  $("heal").classList.toggle("cooldown", me.healCd > 0.05 || me.hp >= me.maxHp);
  const charge = Math.round(me.charge * 100);
  text("charge-percent", charge + "%");
  $("charge-fill").style.width = charge + "%";
  text(
    "charge-hint",
    charge >= 98 ? "TAM GERİLİM · BIRAK VE AT" : "BASILI TUT · BIRAK VE AT",
  );
  text(
    "player-status",
    me.spawnShield > 0
      ? "DOĞUŞ KALKANI"
      : me.hidden
        ? "ÇALIDA GİZLENDİN"
        : "İZİNİ BIRAK",
  );
  text("ping", transport.online ? `${transport.ping} MS` : "30 HZ");
  const sorted = [...current.players]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  $("leaders").replaceChildren(
    ...sorted.map((p, i) => {
      const row = document.createElement("div");
      row.className = "leader-row" + (p.id === myId ? " me" : "");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(i + 1).padStart(2, "0");
      const dot = document.createElement("span");
      dot.className = "swatch";
      dot.style.background = "#" + SKINS[p.skin].body.toString(16);
      const name = document.createElement("span");
      name.textContent = p.name + (p.id === myId ? " · sen" : "");
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = p.score;
      row.append(rank, dot, name, score);
      return row;
    }),
  );
  text("population", `${current.players.length} GÖRÜNÜR OKÇU`);
  const keys = Object.keys(me.upgrades)
    .sort()
    .map((k) => `${k}:${me.upgrades[k]}`)
    .join(",");
  if ($("upgrade-tray").dataset.keys !== keys) {
    $("upgrade-tray").dataset.keys = keys;
    $("upgrade-tray").replaceChildren(
      ...Object.entries(me.upgrades).map(([k, v]) => {
        const e = document.createElement("span");
        e.className = "upgrade-tag";
        e.textContent = UPGRADES[k].icon + (v > 1 ? v : "");
        e.title = UPGRADES[k].name + ": " + v;
        return e;
      }),
    );
  }
  if (me.level > lastLevel) {
    audio.play("level");
    toast(`Seviye ${me.level} — yeni bir yetenek seç!`);
    lastLevel = me.level;
  }
  const ck = me.alive ? me.choices.join(",") : "";
  if (ck !== choicesKey) {
    choicesKey = ck;
    show("upgrades", !!ck);
    $("upgrade-options").replaceChildren(
      ...me.choices.map((key, i) => {
        const u = UPGRADES[key],
          b = document.createElement("button");
        for (const [tag, cls, value] of [
          ["span", "upgrade-icon", u.icon],
          ["span", "upgrade-key", `${i + 1} / PASİF YETENEK`],
          ["strong", "upgrade-name", u.name],
          ["p", "", u.description],
        ]) {
          const el = document.createElement(tag);
          el.className = cls;
          el.textContent = value;
          b.append(el);
        }
        b.onclick = () => {
          transport.choose(key);
        };
        return b;
      }),
    );
  }
  show("death", !me.alive);
  if (!me.alive) {
    text(
      "death-summary",
      `${me.kills} eleme · ${me.score} skor · Seviye ${me.level}`,
    );
    $("respawn").disabled = me.respawnIn > 0.05;
    $("respawn").firstChild.textContent =
      me.respawnIn > 0.05
        ? `Yeniden doğuş: ${Math.ceil(me.respawnIn)}s `
        : "Yeniden doğ ";
  }
  const ctx = $("minimap").getContext("2d"),
    size = 160,
    scale = size / RULES.size;
  ctx.fillStyle = "#203e2b";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#8fb26a22";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 40, 0);
    ctx.lineTo(i * 40, size);
    ctx.moveTo(0, i * 40);
    ctx.lineTo(size, i * 40);
    ctx.stroke();
  }
  ctx.fillStyle = "#8fab6b55";
  for (const o of scene.obstacles || []) {
    ctx.beginPath();
    ctx.arc(
      (o.x + 42) * scale,
      (o.z + 42) * scale,
      o.r * scale,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  for (const p of current.players) {
    if (!p.alive) continue;
    ctx.fillStyle = p.id === myId ? "#e2f7b3" : "#e0ad7a";
    ctx.beginPath();
    ctx.arc(
      (p.x + 42) * scale,
      (p.z + 42) * scale,
      p.id === myId ? 3 : 1.7,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.strokeStyle = "#d7b17e88";
  ctx.strokeRect(0.5, 0.5, 159, 159);
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  accumulator += dt;
  while (accumulator >= 1 / RULES.tick) {
    if (playing && transport) {
      const me = state?.players.find((p) => p.id === myId);
      const next = transport.step(controls.sample(me));
      if (next) consume(next);
    } else {
      atHome.step();
      state = atHome.snapshot();
    }
    accumulator -= 1 / RULES.tick;
  }
  const view = playing && transport?.online ? transport.view() : state;
  scene.render(view, myId, dt, playing);
  if (playing && now - hudAt > 90) {
    updateHud(state);
    hudAt = now;
  }
}
show("loading", false);
show("lobby", true);
requestAnimationFrame(frame);
// Deliberately expose no mutable world or socket on window.
