import { EMOTES, EMOTE_RULES } from "../shared/emotes.js";
import { bindAction } from "./ui.js";

/** One thumb-sized button, with six reactions revealed only while requested. */
export function setupEmotes({ send, canSend, announce }) {
  const root = document.createElement("div");
  root.id = "emote-controls";
  const toggle = document.createElement("button");
  toggle.id = "emote-toggle";
  toggle.type = "button";
  toggle.textContent = "☺";
  toggle.setAttribute("aria-label", "Emoji gönder");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "emote-options");
  const picker = document.createElement("div");
  picker.id = "emote-options";
  picker.className = "hidden";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Emoji seç");
  let availableAt = 0;
  function close() {
    picker.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
  }
  bindAction(toggle, () => {
    if (!canSend()) {
      close();
      return;
    }
    const opening = picker.classList.contains("hidden");
    picker.classList.toggle("hidden", !opening);
    toggle.setAttribute("aria-expanded", String(opening));
  });
  for (const [key, emote] of Object.entries(EMOTES)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = emote.icon;
    button.dataset.emote = key;
    button.setAttribute("aria-label", emote.name);
    bindAction(button, () => {
      if (!canSend()) {
        close();
        return;
      }
      if (performance.now() < availableAt) {
        announce("Emoji hazırlanıyor…");
        return;
      }
      send(key);
      availableAt = performance.now() + EMOTE_RULES.cooldown * 1000;
      close();
      toggle.focus({ preventScroll: true });
    });
    picker.append(button);
  }
  root.append(toggle, picker);
  document.getElementById("hud").append(root);
  document.getElementById("arena").addEventListener("pointerdown", close);
  addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  return {
    close,
    reset() {
      availableAt = 0;
      close();
    },
  };
}
