import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../client/audio.js";
function setup() {
  const oscillators = [],
    gains = [];
  const parameter = () => ({
    values: [],
    setValueAtTime(v, t) {
      this.values.push([v, t]);
    },
    linearRampToValueAtTime(v, t) {
      this.values.push([v, t]);
    },
    exponentialRampToValueAtTime(v, t) {
      this.values.push([v, t]);
    },
  });
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: {},
    createOscillator() {
      const o = {
        frequency: parameter(),
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
        start(t) {
          this.startAt = t;
        },
        stop(t) {
          this.stopAt = t;
        },
      };
      oscillators.push(o);
      return o;
    },
    createGain() {
      const g = {
        gain: parameter(),
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
      };
      gains.push(g);
      return g;
    },
  };
  const audio = new AudioEngine();
  audio.ctx = ctx;
  audio.enabled = true;
  return { audio, ctx, oscillators, gains };
}
test("burst hits create one short voice with a silent attack/release and disconnect when ended", () => {
  const { audio, oscillators, gains } = setup();
  for (let i = 0; i < 100; i++) audio.play("hit");
  assert.equal(oscillators.length, 1);
  const o = oscillators[0],
    g = gains[0];
  assert.equal(o.stopAt, 0.12);
  assert.equal(g.gain.values[0][0], 0);
  assert.equal(g.gain.values.at(-1)[0], 0);
  o.onended();
  assert.equal(audio.voices.size, 0);
  assert.ok(o.disconnected && g.disconnected);
});
test("voices stay bounded during bursts and stop immediately on mute or scene exit", () => {
  const { audio, ctx, oscillators, gains } = setup();
  for (let i = 0; i < 100; i++) {
    ctx.currentTime += 0.071;
    audio.play(i % 2 ? "shot" : "hit");
  }
  assert.equal(audio.voices.size, 8);
  assert.equal(oscillators.length, 8);
  audio.stopAll();
  assert.equal(audio.voices.size, 0);
  assert.ok(oscillators.every((o) => o.stopAt === undefined && o.disconnected));
  assert.ok(gains.every((g) => g.disconnected));
  audio.play("shot");
  assert.equal(audio.voices.size, 1);
  audio.toggle();
  assert.equal(audio.voices.size, 0);
  audio.play("hit");
  assert.equal(oscillators.length, 9);
});

test("mute never opens audio hardware and suspends an existing device until explicit unmute", async (t) => {
  const audio = new AudioEngine();
  audio.enabled = true;
  let created = 0,
    resumes = 0,
    suspends = 0;
  const originalWindow = globalThis.window;
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  globalThis.window = {
    AudioContext: class {
      constructor() {
        created++;
        this.state = "running";
      }
      resume() {
        resumes++;
        this.state = "running";
        return Promise.resolve();
      }
      suspend() {
        suspends++;
        this.state = "suspended";
        return Promise.resolve();
      }
    },
  };
  assert.equal(audio.toggle(), false);
  audio.unlock();
  assert.equal(created, 0);
  assert.equal(audio.ctx, null);
  assert.equal(audio.toggle(), true);
  assert.equal(created, 1);
  const device = audio.ctx;
  assert.equal(audio.toggle(), false);
  await Promise.resolve();
  assert.equal(suspends, 1);
  assert.equal(device.state, "suspended");
  audio.unlock();
  assert.equal(resumes, 0);
  assert.equal(audio.toggle(), true);
  assert.equal(audio.ctx, device);
  assert.equal(created, 1);
  assert.equal(resumes, 1);
});

test("an unavailable audio device does not break mute", async () => {
  const audio = new AudioEngine();
  audio.enabled = true;
  audio.ctx = {
    suspend: () => Promise.reject(new Error("device interrupted")),
  };
  assert.equal(audio.toggle(), false);
  await Promise.resolve();
  assert.equal(audio.enabled, false);
});
