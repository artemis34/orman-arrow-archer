/** Five seconds of visible reading time; choosing explicitly can end it early. */
export class UpgradeReadingWindow {
  constructor(duration = 5000) {
    this.duration = duration;
    this.left = 0;
    this.at = 0;
    this.paused = false;
  }
  start(now = performance.now()) {
    this.left = this.duration;
    this.at = now;
    this.paused = false;
  }
  remaining(now = performance.now()) {
    return Math.max(
      0,
      this.left - (this.paused ? 0 : Math.max(0, now - this.at)),
    );
  }
  pause(now = performance.now()) {
    this.left = this.remaining(now);
    this.paused = true;
  }
  resume(now = performance.now()) {
    this.at = now;
    this.paused = false;
  }
  clear() {
    this.left = 0;
  }
}
