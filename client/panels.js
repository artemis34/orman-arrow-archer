import { bindAction } from "./ui.js";
/** Only the panel the player asks for occupies space. Summary buttons stay put. */
export function setupPanels() {
  const $ = (id) => document.getElementById(id);
  const entries = [
    ["leaders-toggle", "leader-panel"],
    ["map-toggle", null],
    ["vitals-toggle", "vitals-details"],
  ];
  // Map enlargement shares the same hit target and doesn't add an overlay.
  function toggle(buttonId, panelId, open) {
    $(buttonId).setAttribute("aria-expanded", String(open));
    if (panelId) $(panelId).classList.toggle("hidden", !open);
    if (buttonId === "map-toggle") {
      $("map-toggle").parentElement.classList.toggle("expanded", open);
      $("map-toggle").setAttribute(
        "aria-label",
        open ? "Haritayı küçült" : "Haritayı büyüt",
      );
    }
    $("hud").classList.toggle(
      "panel-open",
      entries.some(
        ([button]) => $(button).getAttribute("aria-expanded") === "true",
      ),
    );
  }
  function close() {
    for (const [button, panel] of entries) toggle(button, panel, false);
  }
  for (const [button, panel] of entries)
    bindAction($(button), () => {
      const open = $(button).getAttribute("aria-expanded") !== "true";
      close();
      toggle(button, panel, open);
    });
  $("arena").addEventListener("pointerdown", close);
  return { close };
}
