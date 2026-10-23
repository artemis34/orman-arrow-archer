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
  sample(snapshots, now) {
    const latest = snapshots.at(-1);
    if (!latest) return null;
    const currentEpoch = epoch(latest);
    let start = snapshots.length - 1;
    while (start > 0 && epoch(snapshots[start - 1]) === currentEpoch) start--;
    let offset = Infinity;
    for (let i = start; i < snapshots.length; i++)
      offset = Math.min(offset, snapshots[i].at - stamp(snapshots[i]));
    const target = now - offset - 125;
    const elapsed = now - this.at;
    if (
      this.time === undefined ||
      this.epoch !== currentEpoch ||
      stamp(latest) < this.latestTime ||
      elapsed > 250 ||
      elapsed < 0
    ) {
      this.time = target;
    } else {
      const advance = Math.max(0, elapsed);
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
      fraction: clamp(
        (this.time - stamp(a)) / (stamp(b) - stamp(a) || 1),
        0,
        1,
      ),
    };
  }
}
