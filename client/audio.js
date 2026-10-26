import { preferences } from "./preferences.js";
const SOUNDS = {
  shot: [420, 100, 0.1, 0.045],
  hit: [190, 65, 0.12, 0.07],
  gem: [880, 1320, 0.11, 0.025],
  level: [440, 880, 0.35, 0.06],
  heal: [520, 780, 0.22, 0.04],
  dash: [160, 420, 0.12, 0.035],
  charge: [200, 430, 0.18, 0.025],
};
export class AudioEngine {
  constructor() {
    this.enabled = preferences.get("wildbow-sound") !== "off";
    this.ctx = null;
    this.voices = new Set();
    this.lastPlayed = new Map();
    if (typeof window !== "undefined") {
      window.addEventListener("blur", () => this.stopAll());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.stopAll();
      });
    }
  }
  unlock() {
    if (!this.enabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.ctx || this.ctx.state === "closed") {
        this.stopAll();
        this.ctx = new AudioContext();
      }
      if (this.ctx.state === "suspended" || this.ctx.state === "interrupted")
        this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }
  toggle() {
    this.enabled = !this.enabled;
    preferences.set("wildbow-sound", this.enabled ? "on" : "off");
    if (this.enabled) this.unlock();
    else {
      this.stopAll();
      // Muting must not create/resume an audio device, or keep an existing
      // device running silently. The next explicit unmute resumes it.
      try {
        this.ctx?.suspend?.().catch(() => {});
      } catch {
        // An interrupted/closed audio device must not break the mute control.
      }
    }
    return this.enabled;
  }
  stopAll() {
    for (const voice of this.voices) {
      try {
        voice.oscillator.stop();
      } catch {
        /* Already stopped. */
      }
      voice.cleanup();
    }
    this.lastPlayed.clear();
  }
  play(type) {
    if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    // Burst impacts and multiple XP drops must remain discrete, finite sounds.
    if (
      this.voices.size >= 8 ||
      t - (this.lastPlayed.get(type) ?? -Infinity) < 0.07
    )
      return;
    this.lastPlayed.set(type, t);
    const ctx = this.ctx,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    const [from, to, dur, vol] = SOUNDS[type] || SOUNDS.hit;
    o.type = type === "hit" ? "triangle" : "sine";
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    // A short attack/release avoids the click from an abrupt waveform start.
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur - 0.004);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    const voice = {
      oscillator: o,
      cleanup: () => {
        o.onended = null;
        o.disconnect();
        g.disconnect();
        this.voices.delete(voice);
      },
    };
    this.voices.add(voice);
    o.onended = voice.cleanup;
    o.start(t);
    o.stop(t + dur);
  }
}
