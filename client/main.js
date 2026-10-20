import { setupPanels } from "./panels.js";
import { bindAction } from "./ui.js";
import { selectTarget } from "../shared/aim.js";
import { POWERUPS } from "../shared/powerups.js";
import { preferences } from "./preferences.js";
import { setupProgression } from "./progression.js";
import { FORMATS, TEAMS, formatKey } from "../shared/modes.js";
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
import "./hud.css";
import "./lobby.css";
import "./expansion.css";
import { ArenaScene } from "./scene.js";
import { AudioEngine } from "./audio.js";
import { Controls } from "./controls.js";
import { LocalTransport, SocketTransport } from "./transport.js";
import { WebSocketTransport } from "./websocket.js";
import { roomCode } from "../shared/online.js";
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
const panels = setupPanels();
scene.setMap(atHome.obstacles);
const query = new URLSearchParams(location.search);
const cloudflare =
  import.meta.env.MODE === "cloudflare" || query.get("network") === "websocket";
let format = formatKey(
  query.get("format") || preferences.get("wildbow-format"),
);
let resultKey = "";
let playing = false,
  transport = null,
  state = atHome.snapshot(),
  mode = "practice",
  skin = Math.max(
    0,
    Math.min(SKINS.length - 1, Number(preferences.get("wildbow-skin")) || 0),
  ),
  myId = null,
  lastTime = performance.now(),
  accumulator = 0,
  hudAt = 0,
  choicesKey = "",
  upgradesCollapsed = false,
  lastLevel = 1,
  toastTimer,
  joining = false,
  guardWasActive = false;
const initialServer =
  (cloudflare ? query.get("server") || location.origin : null) ||
  query.get("server") ||
  preferences.get("wildbow-server") ||
  import.meta.env.VITE_SERVER_URL ||
  (["localhost", "127.0.0.1"].includes(location.hostname) ||
  location.hostname.endsWith(".onrender.com")
    ? location.origin
    : "");
$("server-url").value = initialServer;
const progression = setupProgression({
  cloudflare,
  server: () => $("server-url").value || location.origin,
  onSettings: () => {
    scene.setQuality(preferences.get("wildbow-quality") || "balanced");
    document.body.classList.toggle(
      "left-handed",
      preferences.get("wildbow-hand") === "left",
    );
    document.body.classList.toggle(
      "stick-small",
      preferences.get("wildbow-stick") === "small",
    );
    document.body.classList.toggle(
      "stick-large",
      preferences.get("wildbow-stick") === "large",
    );
  },
});
progression.refresh();
$("match-format").value = format;
function updateFormat() {
  format = formatKey($("match-format").value);
  preferences.set("wildbow-format", format);
  text(
    "format-note",
    FORMATS[format].duel
      ? "Eşit başlangıç · Online düelloda bot yok · Rastgele yetenek yok"
      : FORMATS[format].teams
        ? `${FORMATS[format].teams} takım · Dost ateşi kapalı · 4 dakika`
        : format === "round"
          ? "4 dakika · Eleme, asist ve sunak puanı"
          : "Kristalleri topla, yeteneklerini geliştir.",
  );
}
$("match-format").addEventListener("change", () => {
  updateFormat();
  setMode(mode);
});
updateFormat();
$("room-code").value = roomCode(query.get("room") || "arena") || "arena";
show("server-address", !cloudflare);
show("room-field", cloudflare);
$("player-name").value = preferences.get("wildbow-name") || "Gezgin";
for (const [i, s] of SKINS.entries()) {
  const b = document.createElement("button");
  b.className = "skin" + (i === skin ? " selected" : "");
  b.style.setProperty("--skin", "#" + s.body.toString(16));
  b.setAttribute("aria-label", s.name);
  b.setAttribute("aria-pressed", String(i === skin));
  b.addEventListener("click", () => {
    skin = i;
    preferences.set("wildbow-skin", String(skin));
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
  show("room-access", cloudflare && mode === "online");
  for (const id of ["practice-mode", "online-mode"])
    $(id).setAttribute(
      "aria-pressed",
      String($(id).classList.contains("selected")),
    );
  text(
    "join-status",
    mode === "practice"
      ? "Botlarla anında oyna · Hesap gerekmez"
      : cloudflare
        ? privateRoom
          ? "Davet bağlantısını paylaş, aynı arenada buluş."
          : "Uygun bir arenaya otomatik katıl."
        : "Gerçek oyuncular · Sunucu bağlantısı gerekir",
  );
  text(
    "server-label",
    mode === "practice"
      ? `Yerel arena · ${Math.min(7, FORMATS[format].capacity - 1)} bot rakip`
      : `Online · En fazla ${FORMATS[format].capacity} oyuncu`,
  );
}
let privateRoom = !!query.get("room") && query.get("match") !== "quick";
function setRoomAccess(privateMatch) {
  privateRoom = privateMatch;
  show("room-field", cloudflare && privateRoom);
  $("quick-match").setAttribute("aria-pressed", String(!privateRoom));
  $("friend-room").setAttribute("aria-pressed", String(privateRoom));
  $("quick-match").classList.toggle("selected", !privateRoom);
  $("friend-room").classList.toggle("selected", privateRoom);
  setMode(mode);
}
bindAction($("quick-match"), () => setRoomAccess(false));
bindAction($("friend-room"), () => {
  if (!query.get("room") && $("room-code").value === "arena")
    $("room-code").value = `friends-${crypto.randomUUID().slice(0, 6)}`;
  setRoomAccess(true);
});
$("practice-mode").onclick = () => setMode("practice");
$("online-mode").onclick = () => setMode("online");
setMode(cloudflare ? "online" : "practice");
setRoomAccess(privateRoom);
bindAction($("copy-invite"), async () => {
  const room = roomCode($("room-code").value);
  if (!room) {
    text("join-status", "Oda kodu 3–24 harf, rakam veya tire içermeli.");
    return;
  }
  const invite = new URL(location.href);
  invite.searchParams.set("room", room);
  invite.searchParams.set("format", format);
  invite.searchParams.delete("match");
  // A shared external/static frontend must retain its explicit server adapter.
  if (query.get("network")) invite.searchParams.set("network", "websocket");
  try {
    await navigator.clipboard.writeText(invite.href);
    text("join-status", "Davet bağlantısı kopyalandı.");
  } catch {
    text("join-status", "Adres çubuğundaki bağlantıyı paylaşabilirsin.");
    history.replaceState(null, "", invite);
  }
});
function syncSound() {
  for (const b of document.querySelectorAll(".sound-button")) {
    b.textContent = audio.enabled ? "♫" : "♩";
    b.setAttribute("aria-pressed", String(audio.enabled));
    b.title = audio.enabled ? "Sesi kapat" : "Sesi aç";
  }
}
for (const b of document.querySelectorAll(".sound-button"))
  bindAction(b, () => {
    audio.toggle();
    syncSound();
  });
syncSound();
function syncAutoFire() {
  $("auto-fire").setAttribute("aria-pressed", String(controls.autoFire));
  text("auto-fire-label", controls.autoFire ? "OTO AÇIK" : "OTO KAPALI");
  $("auto-fire").title = controls.autoFire
    ? "Otomatik atışı kapat"
    : "Otomatik atışı aç · tek elle oyna";
}
controls.setAutoFire(preferences.get("wildbow-auto-fire") === "true");
function setControls(oneHanded) {
  controls.setOneHanded(oneHanded);
  if (!oneHanded)
    controls.setAutoFire(preferences.get("wildbow-auto-fire") === "true");
  preferences.set("wildbow-controls", oneHanded ? "onehand" : "classic");
  document.body.classList.toggle("onehand", oneHanded);
  for (const [id, selected] of [
    ["classic-controls", !oneHanded],
    ["onehand-controls", oneHanded],
  ]) {
    $(id).classList.toggle("selected", selected);
    $(id).setAttribute("aria-pressed", String(selected));
  }
  text(
    "controls-hint",
    oneHanded
      ? "Yönlendir, otomatik ateş et. Rakibe dokunarak kilitlen."
      : "İki joystick veya klavye ve fare ile kontrol sende.",
  );
  syncAutoFire();
}
bindAction($("classic-controls"), () => setControls(false));
bindAction($("onehand-controls"), () => setControls(true));
setControls(preferences.get("wildbow-controls") === "onehand");
syncAutoFire();
bindAction($("auto-fire"), () => {
  audio.unlock();
  controls.setAutoFire(!controls.autoFire);
  preferences.set("wildbow-auto-fire", String(controls.autoFire));
  syncAutoFire();
});
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

$("help-close").onclick = () => help(false);
addEventListener("keydown", (e) => {
  if (e.code === "Escape" && !$("help").classList.contains("hidden"))
    help(false);
  if (
    playing &&
    !e.repeat &&
    choicesKey &&
    ["Digit1", "Digit2", "Digit3"].includes(e.code)
  ) {
    const b = $("upgrade-options").children[Number(e.code.slice(-1)) - 1];
    b?.click();
  }
});
bindAction($("upgrades-collapse"), () => {
  upgradesCollapsed = true;
  show("upgrades", false);
  show("upgrade-reminder", !!choicesKey);
});
bindAction($("upgrade-reminder"), () => {
  upgradesCollapsed = !upgradesCollapsed;
  show("upgrades", !upgradesCollapsed);
  show("upgrade-reminder", upgradesCollapsed && !!choicesKey);
});
function toast(message) {
  text("toast", message);
  show("toast", true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show("toast", false), 1100);
}
function consume(next) {
  state = next;
  if (!playing) return;
  const me = next.players.find((p) => p.id === myId);
  if (me) {
    const guarded = me.levelGuard > 0;
    if (guarded && !guardWasActive) {
      panels.close();
    }
    controls.active =
      me.alive &&
      (!next.match || next.match.phase === "playing") &&
      $("help").classList.contains("hidden");
    guardWasActive = guarded;
  }
  for (const e of next.events || []) {
    if (e.type === "kill") {
      const row = document.createElement("div");
      row.className = "kill-entry";
      const b = document.createElement("b");
      b.textContent = e.killer;
      row.append(b, document.createTextNode("  ↗  " + e.name));
      $("kill-feed").replaceChildren(row);
      setTimeout(() => row.remove(), 5500);
    } else if (e.type === "hit" && e.kind !== "poison") {
      scene.burst(e.x, e.z, 0xf4c98b, 7);
      if (e.owner === myId || e.target === myId) {
        audio.play("hit");
        if (e.target === myId && preferences.get("wildbow-haptics") !== "false")
          navigator.vibrate?.(18);
      }
    } else if (e.type === "shot") {
      if (e.owner === myId) {
        audio.play("shot");
      }
    } else if (
      e.type === "blast" ||
      e.type === "frost" ||
      e.type === "ricochet"
    ) {
      scene.burst(
        e.x,
        e.z,
        e.type === "blast"
          ? 0xffbd73
          : e.type === "frost"
            ? 0x9ce6fa
            : 0xeee9be,
        e.type === "blast" ? 12 : 5,
      );
    } else if (e.type === "buff") {
      const buff = POWERUPS[e.key];
      if (buff) scene.burst(e.x, e.z, buff.color, 12);
      if (buff && e.owner === myId) {
        audio.play("level");
        toast(`${buff.icon} ${buff.description} · 15s`);
      }
    } else if (e.type === "gem" && e.owner === myId) {
      scene.burst(e.x, e.z, e.rare ? 0xffd680 : 0xd1f59b, e.rare ? 12 : 4);
      if (e.rare) toast("✧ +60 XP");
      audio.play("gem");
    } else if (e.type === "guardHit") {
      scene.burst(e.x, e.z, 0xbde0ff, 6);
    } else if (e.type === "shrineStart" || e.type === "shrineClaim") {
      scene.burst(0, 0, 0xffd278, 16);
      toast(
        e.type === "shrineStart"
          ? "✧ Orman Sunağı açıldı · Haritaya bak"
          : "✧ Sunak ele geçirildi",
      );
    } else if (e.type === "heal") {
      scene.burst(e.x, e.z, 0xa8efa1, 14);
      if (e.owner === myId) {
        audio.play("level");
        toast(`+${e.amount || 25} CAN`);
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
  preferences.set("wildbow-name", name);
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
      preferences.set("wildbow-server", url);
      text("join-status", "Arenaya bağlanılıyor…");
      const onDisconnect = () => {
        leave();
        text(
          "join-status",
          "Bağlantı kesildi. Tekrar katılabilir veya antrenmanı seçebilirsin.",
        );
      };
      if (cloudflare) {
        const room = roomCode($("room-code").value);
        if (!room)
          throw new Error("Oda kodu 3–24 harf, rakam veya tire içermeli.");
        candidate = new WebSocketTransport(url, consume, onDisconnect, {
          room,
          matchmake: !privateRoom,
          viewRadius: scene.networkRadius(),
          format,
        });
      } else candidate = new SocketTransport(url, consume, onDisconnect);
    } else candidate = new LocalTransport(format);
    candidate.onProfile = (next) => progression.apply(next);
    const welcome = await candidate.connect(name, skin, {
      format,
      room: privateRoom ? roomCode($("room-code").value) : undefined,
      profileToken:
        cloudflare && mode === "online" ? progression.token : undefined,
      cosmetics: progression.equipped,
    });
    scene.setMap(welcome.obstacles);
    if (cloudflare && candidate.online) {
      const invite = new URL(location.href);
      invite.searchParams.set("room", welcome.room);
      invite.searchParams.set("format", format);
      if (!privateRoom) invite.searchParams.set("match", "quick");
      else invite.searchParams.delete("match");
      $("room-code").value = welcome.room;
      history.replaceState(null, "", invite);
    }
    transport = candidate;
    myId = welcome.id;
    playing = true;
    resultKey = "";
    controls.active = true;
    controls.reset();
    if (controls.oneHanded) controls.setAutoFire(true);
    syncAutoFire();
    lastLevel = 1;
    choicesKey = "";
    upgradesCollapsed = false;
    accumulator = 0;
    state = transport.online ? null : transport.world.snapshot(myId);
    show("lobby", false);
    show("hud", true);
    document.body.classList.add("playing");
    text("connection", transport.online ? "ONLINE" : "YEREL");
    panels.close();
    guardWasActive = false;
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
  audio.stopAll();
  playing = false;
  controls.active = false;
  controls.reset();
  transport?.close();
  transport = null;
  myId = null;
  panels.close();
  state = atHome.snapshot();
  scene.setMap(atHome.obstacles);
  for (const id of [
    "hud",
    "death",
    "upgrades",
    "help",
    "upgrade-reminder",
    "round-results",
  ])
    show(id, false);
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
bindAction($("exit"), leave);
bindAction($("back-lobby"), leave);
bindAction($("results-exit"), leave);
bindAction($("rematch"), () => transport?.rematch());
bindAction($("reroll"), () => transport?.reroll());
bindAction($("respawn"), () => {
  transport?.respawn();
  controls.reset();
});
function updateHud(current) {
  const me = current?.players.find((p) => p.id === myId);
  if (!me) return;
  const match = current.match;
  const finished = match?.phase === "results";
  show("match-status", !!match);
  if (match) {
    const seconds = Math.max(0, match.remaining);
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const team = me.team != null ? match.teams[me.team] : null;
    text(
      "match-status",
      match.phase === "waiting"
        ? "Rakip bekleniyor…"
        : `${time}${team ? `\n${team.symbol} ${team.name} · ${team.score}` : " · Tur " + match.round}`,
    );
  }
  show("round-results", finished);
  if (finished) {
    controls.active = false;
    controls.reset();
    const key = `${match.format}:${match.round}`;
    text(
      "round-countdown",
      `Yeni maç ${match.remaining} sn sonra · ${match.votes.length} oyuncu hazır`,
    );
    $("rematch").disabled = match.votes.includes(myId);
    if (key !== resultKey) {
      resultKey = key;
      audio.play("level");
      $("rematch").focus();
      const top = [...match.teams].sort((a, b) => b.score - a.score);
      text(
        "round-winner",
        top.length
          ? top[0].score === top[1]?.score
            ? "Takımlar berabere"
            : `${top[0].symbol} ${top[0].name} kazandı`
          : !match.results.length ||
              match.results[0].points === match.results[1]?.points
            ? "Berabere"
            : `${match.results[0].name} kazandı`,
      );
      const rows = [
        {
          name: "OKÇU",
          kills: "E",
          assists: "A",
          points: "PUAN",
          heading: true,
        },
        ...match.results,
      ];
      $("round-ranking").replaceChildren(
        ...rows.map((p) => {
          const row = document.createElement("div");
          row.className =
            "results-row" +
            (p.id === myId ? " me" : "") +
            (p.heading ? " heading" : "");
          for (const value of [
            p.team != null ? `${TEAMS[p.team].symbol} ${p.name}` : p.name,
            p.kills,
            p.assists,
            p.points,
          ]) {
            const cell = document.createElement("span");
            cell.textContent = value;
            row.append(cell);
          }
          return row;
        }),
      );
      text(
        "round-reward",
        transport.online && cloudflare
          ? "En az 30 sn katıldığın maçlardan 20+ yaprak kazanırsın. Ödüllerin profiline kaydedilir."
          : transport.online
            ? "Maç tamamlandı."
            : "Antrenman tamamlandı. Yaprak ve başarımlar online maçlarda kazanılır.",
      );
    }
  } else resultKey = "";
  $("reroll").disabled = !!me.rerolled;
  $("reroll").title = me.rerolled
    ? "Yenileme hakkı kullanıldı"
    : "Kartları yenile · Maçta bir kez";
  text("hud-name", me.name);
  text("level", me.level);
  text("kills", me.kills);
  text("health-text", `${Math.ceil(me.hp)} / ${me.maxHp}`);
  const buff = me.alive && me.buffTime > 0 ? POWERUPS[me.buffType] : null;
  show("buff-status", !!buff);
  if (buff) {
    text("buff-status", `${buff.icon} ${Math.ceil(me.buffTime)}s`);
    $("buff-status").style.color = buff.color;
    $("buff-status").setAttribute(
      "aria-label",
      `${buff.name}: ${buff.description}, ${Math.ceil(me.buffTime)} saniye`,
    );
    $("buff-status").title = `${buff.name}: ${buff.description}`;
  }
  $("health-fill").style.width = `${(me.hp / me.maxHp) * 100}%`;
  $("xp-fill").style.width = `${(me.xp / (me.level * 55)) * 100}%`;
  text("xp-text", `${me.xp} / ${me.level * 55}`);
  text("xp-remaining", `${Math.max(0, me.level * 55 - me.xp)} XP kaldı`);
  text("dash-time", me.dashCd > 0.05 ? me.dashCd.toFixed(1) : "");
  $("dash").classList.toggle("cooldown", me.dashCd > 0.05);
  text("heal-time", me.healCd > 0.05 ? me.healCd.toFixed(0) : "");
  $("heal").classList.toggle("cooldown", me.healCd > 0.05 || me.hp >= me.maxHp);
  $("health-fill").classList.toggle("critical", me.hp < me.maxHp * 0.3);
  $("dash").disabled = $("heal").disabled = me.levelGuard > 0;
  $("hud").classList.toggle("guarded", me.levelGuard > 0);
  text(
    "guard-time",
    me.levelGuard > 0 ? `KORUMA ${me.levelGuard.toFixed(1)}s` : "",
  );
  text(
    "reminder-time",
    me.levelGuard > 0 ? `${Math.ceil(me.levelGuard)}s` : "",
  );
  const charge = Math.round(me.charge * 100);
  document
    .querySelector(".arena-charge")
    .classList.toggle("hidden", charge <= 0);
  text("charge-percent", charge + "%");
  $("charge-fill").style.width = charge + "%";
  const autoTarget =
    controls.isTouch || controls.autoFire
      ? selectTarget(me, current.players, scene.obstacles)
      : null;
  text(
    "charge-hint",
    charge >= 98
      ? "TAM GERİLİM · BIRAK VE AT"
      : controls.isTouch || controls.autoFire
        ? charge > 0
          ? "BIRAK: HIZLI OK"
          : me.shotCd > 0.04
            ? `YENİ ATIŞ: ${me.shotCd.toFixed(1)}s`
            : autoTarget
              ? `OTO HEDEF: ${autoTarget.name}`
              : "DOKUN: OTO ATIŞ · ÇEK: NİŞAN"
        : "BASILI TUT · BIRAK VE AT",
  );
  text(
    "player-status",
    me.levelGuard > 0
      ? "SEÇİM KORUMASI"
      : me.spawnShield > 0
        ? "DOĞUŞ KALKANI"
        : me.hidden
          ? "ÇALIDA GİZLENDİN"
          : buff
            ? `${buff.icon} ${buff.description} · ${Math.ceil(me.buffTime)}s`
            : "İZİNİ BIRAK",
  );
  $("connection").title = transport.online
    ? `Gecikme: ${transport.ping} ms`
    : "Botlarla antrenman";
  const ranking = [...(current.roster || current.players)].sort((a, b) =>
    match ? (b.matchPoints || 0) - (a.matchPoints || 0) : b.score - a.score,
  );
  text("my-rank", Math.max(1, ranking.findIndex((p) => p.id === myId) + 1));
  const sorted = ranking.slice(0, 3);
  $("leaders").replaceChildren(
    ...sorted.map((p, i) => {
      const row = document.createElement("div");
      row.className = "arena-leader-row" + (p.id === myId ? " me" : "");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(i + 1).padStart(2, "0");
      const dot = document.createElement("span");
      dot.className = "swatch";
      dot.style.background =
        p.team != null
          ? TEAMS[p.team].color
          : "#" + SKINS[p.skin].body.toString(16);
      const name = document.createElement("span");
      name.textContent =
        (p.team != null ? TEAMS[p.team].symbol + " " : "") +
        p.name +
        (p.id === myId ? " · sen" : "");
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = match ? p.matchPoints || 0 : p.score;
      row.append(rank, dot, name, score);
      return row;
    }),
  );
  const humans = ranking.filter((p) => !p.bot).length,
    bots = ranking.length - humans;
  text("population", `${humans} OYUNCU${bots ? ` · ${bots} BOT` : ""}`);
  const keys = Object.keys(me.upgrades)
    .sort()
    .map((k) => `${k}:${me.upgrades[k]}`)
    .join(",");
  if ($("upgrade-tray").dataset.keys !== keys) {
    $("upgrade-tray").dataset.keys = keys;
    $("upgrade-tray").replaceChildren(
      ...Object.entries(me.upgrades).map(([k, v]) => {
        const e = document.createElement("span");
        e.className = "arena-upgrade-tag";
        e.textContent = UPGRADES[k].icon + (v > 1 ? v : "");
        e.title = UPGRADES[k].name + ": " + v;
        return e;
      }),
    );
  }
  if (me.level > lastLevel) {
    audio.play("level");

    lastLevel = me.level;
  }
  const ck =
    me.alive && me.choices.length
      ? `${me.pending}:${me.choices.join(",")}`
      : "";
  if (ck !== choicesKey) {
    choicesKey = ck;
    text("upgrade-count", me.pending > 1 ? `· ${me.pending} bekliyor` : "");
    upgradesCollapsed = false;
    show("upgrades", !!ck);
    show("upgrade-reminder", false);
    $("upgrade-options").replaceChildren(
      ...me.choices.map((key, i) => {
        const u = UPGRADES[key],
          b = document.createElement("button");
        for (const [tag, cls, value] of [
          ["span", "perk-icon", u.icon],
          ["span", "perk-key", `${i + 1}`],
          ["strong", "perk-name", u.name],
          ["p", "", u.description],
        ]) {
          const el = document.createElement(tag);
          el.className = cls;
          el.textContent = value;
          b.append(el);
        }
        b.setAttribute("aria-label", u.name + ": " + u.description);
        bindAction(b, () => transport.choose(key));
        return b;
      }),
    );
  }
  show("death", !me.alive && !finished);
  if (!me.alive) {
    text(
      "death-summary",
      `${me.kills} eleme · ${me.assists || 0} asist · Seviye ${me.level}${me.lastDeath ? ` · Son vuruş: ${me.lastDeath.killer} (${me.lastDeath.amount})` : ""}`,
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
  ctx.fillStyle = "#8fab6b77";
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
  for (const orb of current.orbs) {
    if (!orb.rare) continue;
    const x = (orb.x + 42) * scale,
      y = (orb.z + 42) * scale;
    ctx.strokeStyle = "#ffd278bb";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 6 + Math.sin(performance.now() / 350) * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffd278";
    ctx.strokeStyle = "#152b20";
    ctx.beginPath();
    ctx.moveTo(x, y - 4.2);
    ctx.lineTo(x + 4.2, y);
    ctx.lineTo(x, y + 4.2);
    ctx.lineTo(x - 4.2, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  for (const site of current.powerups || []) {
    const spec = POWERUPS[site.key];
    if (!spec) continue;
    const x = (site.x + 42) * scale,
      y = (site.z + 42) * scale;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = spec.color;
    ctx.fillStyle = site.cooldown > 0 ? "#203e2b" : spec.color;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (site.cooldown <= 0) {
      ctx.fillStyle = "#12251f";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(spec.icon, x, y + 3);
    }
  }
  for (const p of current.players) {
    if (!p.alive) continue;
    ctx.fillStyle =
      p.id === myId
        ? "#e2f7b3"
        : p.team != null
          ? TEAMS[p.team].color
          : "#e0ad7a";
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
  if (
    current.objective &&
    (current.objective.active || current.objective.remaining <= 10)
  ) {
    ctx.fillStyle = current.objective.contested ? "#f58b83" : "#ffd278";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("✧", 80, 85);
  }
  ctx.strokeRect(0.5, 0.5, 159, 159);
}
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || (!playing && now - lastTime < 1000 / 30)) return;
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  // Background mobile tabs stop sending input, allowing abandoned Cloudflare
  // sessions to expire instead of leaving a bot arena running indefinitely.
  if (cloudflare && playing && transport?.online && document.hidden) return;
  accumulator += dt;
  while (accumulator >= 1 / RULES.tick) {
    if (playing && transport && !transport.online) {
      const me = state?.players.find((p) => p.id === myId);
      const next = transport.step(controls.sample(me, state, scene.obstacles));
      if (next) consume(next);
    } else if (!playing) {
      atHome.step();
      state = atHome.snapshot();
    }
    accumulator -= 1 / RULES.tick;
  }
  const view = playing && transport?.online ? transport.view() : state;
  const me = view?.players.find((p) => p.id === myId);
  const target =
    playing && (controls.isTouch || controls.autoFire) && me?.alive
      ? (me.lockedTargetId &&
          view.players.find((p) => p.id === me.lockedTargetId)) ||
        selectTarget(
          me,
          view.players,
          scene.obstacles,
          controls.charge ? { angle: controls.angle, cone: 0.16 } : {},
        )
      : null;
  scene.render(view, myId, dt, playing, target?.id);
  if (playing && now - hudAt > 90) {
    updateHud(state);
    hudAt = now;
  }
}
// Network input must keep its cadence even when rendering is slow. Otherwise a
// busy mobile GPU can trigger the authority's stale-input watchdog mid-draw.
setInterval(() => {
  if (!playing || !transport?.online || document.hidden) return;
  const me = transport.localPose() || state?.players.find((p) => p.id === myId);
  transport.step(controls.sample(me, state, scene.obstacles));
}, 1000 / RULES.tick);
controls.onNoTarget = () => toast("Hedef yok");
addEventListener("resize", () =>
  transport?.updateView?.(scene.networkRadius()),
);
show("loading", false);
show("lobby", true);
requestAnimationFrame(frame);
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register(new URL("sw.js", document.baseURI))
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      registration.active?.postMessage({
        type: "CACHE_ASSETS",
        urls: performance
          .getEntriesByType("resource")
          .map((entry) => entry.name),
      });
    })
    .catch(() => {});
}
// Deliberately expose no mutable world or socket on window.
