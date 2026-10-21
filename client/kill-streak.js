/** The authority publishes this life-only count as optional roster metadata. */
export class KillStreakBadge {
  constructor(element) {
    this.element = element;
    this.number = element.querySelector("strong");
    this.count = -1;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  }
  update(value, alive) {
    const count =
      alive && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (count === this.count) return;
    const previous = this.count;
    this.count = count;
    this.element.classList.toggle("hidden", count < 2);
    this.animation?.cancel();
    if (count < 2) return;
    // The flame grows with each kill but stays inside a bounded HUD footprint.
    const heat = 1 - Math.exp(-(count - 1) / 6);
    this.element.style.setProperty("--streak-heat", heat.toFixed(4));
    this.element.classList.toggle("long-streak", count >= 1000);
    this.number.textContent = count > 9999 ? "9999+" : String(count);
    this.element.setAttribute(
      "aria-label",
      `Ölmeden ${count} eleme. Kill streak.`,
    );
    if (count > previous && !this.reduceMotion.matches)
      this.animation = this.element.animate(
        [
          { transform: "scale(.94)" },
          { transform: "scale(1.08)", offset: 0.4 },
          { transform: "scale(1)" },
        ],
        { duration: 280, easing: "ease-out" },
      );
  }
}
