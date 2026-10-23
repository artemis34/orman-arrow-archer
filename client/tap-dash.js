/** Recognize movement-area touch gestures independently of browser click events.
 * The caller owns pointer capture and suppresses browser gestures only on the
 * game surface. A dash consumes the pair; dragging never arms the next tap.
 */
export class TapDashDetector {
  constructor() {
    this.last = null;
  }
  reset() {
    this.last = null;
  }
  release({
    x,
    y,
    startedAt,
    endedAt,
    dragged = false,
    cancelled = false,
    pointerType = "touch",
  } = {}) {
    const duration = endedAt - startedAt;
    if (
      pointerType !== "touch" ||
      dragged ||
      cancelled ||
      ![x, y, startedAt, endedAt].every(Number.isFinite) ||
      duration < 0 ||
      duration > 180
    ) {
      this.reset();
      return false;
    }
    if (this.last) {
      const gap = startedAt - this.last.endedAt;
      // Out-of-order releases cannot establish a new gesture candidate.
      if (gap < 0) {
        this.reset();
        return false;
      }
      if (gap <= 280 && Math.hypot(x - this.last.x, y - this.last.y) <= 32) {
        this.reset();
        return true;
      }
    }
    this.last = { x, y, endedAt };
    return false;
  }
}
