import { clamp } from "../shared/config.js";

const stamp = (snapshot) =>
  Number.isFinite(snapshot.state.time)
    ? snapshot.state.time * 1000
    : snapshot.at;
const epoch = (snapshot) =>
  snapshot.state.match
    ? `${snapshot.state.match.round}:${snapshot.state.match.phase}`
    : "arena";

/** Read-only display clock. Packet jitter must not change walking speed.
 * No extrapolation, physics updates, wire changes or authority decisions.
 */
export class PresentationClock {
  constructor({ delay = 125, maxDelay = 250, resetOnBackward = true } = {}) {
    this.baseDelay = delay;
    this.maxDelay = Math.max(delay, maxDelay);
    this.delay = delay;
    this.rate = 1;
    this.timings = [];
    this.resetOnBackward = resetOnBackward;
  }

  observe(latest, currentEpoch) {
    if (latest === this.observed) return;
    const time = stamp(latest);
    if (this.observedEpoch !== currentEpoch || time < this.observedTime) {
      this.timings.length = 0;
      this.rate = 1;
      this.timingRate = 1;
      this.delay = this.baseDelay;
      this.rateReady = false;
    }
    this.observed = latest;
    this.observedEpoch = currentEpoch;
    this.observedTime = time;
    const previousAt = this.timings.at(-1)?.at;
    this.timings.push({ at: latest.at, time });
    if (this.timings.length > 16) this.timings.shift();
    const history = this.timings;
    // Regress wall-clock arrival against the exact simulation timestamps.
    // Regressing the opposite way biases the rate downward under packet jitter.
    // A one-second history separates sustained slow simulation from one burst;
    // a shorter perfectly paced stream can safely calibrate before underflow.
    if (
      history.length >= 4 &&
      time - history[0].time >= 150 &&
      latest.at - history[0].at >= 150
    ) {
      let meanTime = 0,
        meanAt = 0;
      for (const sample of history) {
        meanTime += sample.time;
        meanAt += sample.at;
      }
      meanTime /= history.length;
      meanAt /= history.length;
      let variance = 0,
        covariance = 0;
      for (const sample of history) {
        const dt = sample.time - meanTime;
        variance += dt * dt;
        covariance += dt * (sample.at - meanAt);
      }
      if (variance > 0 && covariance > 0) {
        let measured = clamp(variance / covariance, 0.5, 1.1);
        let lowResidual = Infinity,
          highResidual = -Infinity;
        for (const sample of history) {
          const residual = sample.at - sample.time / measured;
          lowResidual = Math.min(lowResidual, residual);
          highResidual = Math.max(highResidual, residual);
        }
        const established =
          (history.length >= 12 &&
            time - history[0].time >= 700 &&
            latest.at - history[0].at >= 700) ||
          highResidual - lowResidual <= 10;
        if (established) {
          this.timingRate = measured;
          // Ordinary timer drift and jitter already fit the gentle 10% clock
          // correction. Keep a nominal stream exactly nominal, avoiding a
          // constantly breathing display speed in response to packet arrival.
          if (measured >= 0.9 && measured <= 1.1) measured = 1;
          const blend = this.rateReady
            ? 1 - Math.exp(-Math.max(0, latest.at - previousAt) / 250)
            : 1;
          this.rate += (measured - this.rate) * blend;
          this.rateReady = true;
        }
      }
    }
    let jitter = 0;
    const timingRate = this.timingRate || this.rate;
    for (let i = 1; i < history.length; i++) {
      const before = history[i - 1],
        sample = history[i];
      // Excess inter-arrival time detects actual packet bursts without
      // confusing the slow bend of a recovering server clock with jitter.
      jitter = Math.max(
        jitter,
        sample.at - before.at - (sample.time - before.time) / timingRate,
      );
    }
    const interval =
      history.length > 1
        ? (time - history[0].time) / (history.length - 1) / timingRate
        : 1000 / 15;
    const desired =
      jitter > 95
        ? clamp(jitter + interval + 15, this.baseDelay, this.maxDelay)
        : this.baseDelay;
    // Add protection for a measured burst promptly; release it slowly once the
    // stream recovers. Only the display clock changes, never authority/input.
    if (desired >= this.delay) this.delay = desired;
    else
      this.delay +=
        (desired - this.delay) *
        (1 - Math.exp(-Math.max(0, latest.at - previousAt) / 5000));
  }

  sample(snapshots, now) {
    const latest = snapshots.at(-1);
    if (!latest) return null;
    const currentEpoch = epoch(latest);
    let start = snapshots.length - 1;
    while (start > 0 && epoch(snapshots[start - 1]) === currentEpoch) start--;
    // Several reliable packets may arrive between display frames. Observe all
    // of them, including the delayed head of a burst, rather than only its
    // quickly-following last packet (which would hide the measured jitter).
    const observedAt = snapshots.indexOf(this.observed);
    for (let i = Math.max(start, observedAt + 1); i < snapshots.length; i++)
      this.observe(snapshots[i], currentEpoch);
    let offset = Infinity;
    for (let i = start; i < snapshots.length; i++)
      offset = Math.min(
        offset,
        snapshots[i].at - stamp(snapshots[i]) / this.rate,
      );
    const target = (now - offset - this.delay) * this.rate;
    const elapsed = now - this.at;
    if (
      this.time === undefined ||
      this.epoch !== currentEpoch ||
      stamp(latest) < this.latestTime ||
      elapsed > 250 ||
      (elapsed < 0 && this.resetOnBackward)
    ) {
      this.time = target;
    } else {
      const advance = Math.max(0, elapsed) * this.rate;
      const next = this.time + advance;
      this.time = next + clamp(target - next, -advance * 0.1, advance * 0.1);
    }
    this.at = now;
    this.epoch = currentEpoch;
    this.latestTime = stamp(latest);
    let a = snapshots[start],
      b = a;
    for (let i = start + 1; i < snapshots.length; i++) {
      b = snapshots[i];
      if (stamp(b) >= this.time) break;
      a = b;
    }
    return {
      a,
      b,
      start,
      fraction: clamp(
        (this.time - stamp(a)) / (stamp(b) - stamp(a) || 1),
        0,
        1,
      ),
    };
  }
}
