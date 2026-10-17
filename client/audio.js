export class AudioEngine {
  constructor() {
    this.enabled = localStorage.getItem("wildbow-sound") !== "off";
    this.ctx = null;
  }
  unlock() {
    if (!this.ctx)
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
  }
  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("wildbow-sound", this.enabled ? "on" : "off");
    this.unlock();
    return this.enabled;
  }
  play(type) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx,
      o = ctx.createOscillator(),
      g = ctx.createGain(),
      t = ctx.currentTime;
    const sounds = {
      shot: [420, 100, 0.1, 0.045],
      hit: [190, 65, 0.12, 0.07],
      gem: [880, 1320, 0.11, 0.025],
      level: [440, 880, 0.35, 0.06],
      dash: [160, 420, 0.12, 0.035],
      charge: [200, 430, 0.18, 0.025],
    };
    const [from, to, dur, vol] = sounds[type] || sounds.hit;
    o.type = type === "hit" ? "triangle" : "sine";
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur);
  }
}
