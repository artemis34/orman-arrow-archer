import { clamp, RULES } from "../shared/config.js";
import { segmentFraction } from "../shared/spatial.js";
import { PresentationClock } from "./presentation-clock.js";

const stamp = (snapshot) =>
  Number.isFinite(snapshot.state.time)
    ? snapshot.state.time * 1000
    : snapshot.at;
const index = (snapshot) =>
  (snapshot.arrowIndex ||= new Map(
    snapshot.state.arrows.map((arrow) => [arrow.id, arrow]),
  ));
const turn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Display only. Never produces hits, changes authority, or adds wire fields. */
export class ProjectilePresentation {
  constructor() {
    this.clock = new PresentationClock({
      delay: 100,
      maxDelay: 250,
      // Preserve the existing arrow clock's hold when a synthetic/replayed
      // clock goes backward. Browser performance.now itself is monotonic.
      resetOnBackward: false,
    });
  }
  get time() {
    return this.clock.time;
  }
  view(snapshots, now, obstacles = []) {
    const latest = snapshots.at(-1);
    if (!latest) return [];
    // The same measured-rate clock as remote movement keeps slow authority or
    // packet bursts from repeatedly draining the arrow interpolation buffer.
    const { start } = this.clock.sample(snapshots, now);
    if (this.time < stamp(snapshots[start])) return [];
    let a = latest,
      b = latest;
    for (let i = start + 1; i < snapshots.length; i++)
      if (stamp(snapshots[i]) > this.time) {
        a = snapshots[i - 1];
        b = snapshots[i];
        break;
      }
    const current = index(latest),
      next = index(b);
    const span = stamp(b) - stamp(a);
    const fraction = span > 0 ? clamp((this.time - stamp(a)) / span, 0, 1) : 0;
    const previous =
      a === latest && snapshots.length - 1 > start
        ? snapshots[snapshots.length - 2]
        : null;
    const result = [];
    for (const arrow of a.state.arrows) {
      const authoritative = current.get(arrow.id);
      // Death/cover/expiry/removal take effect immediately; no buffered ghosts.
      if (!authoritative) continue;
      const after = next.get(arrow.id);
      let x = arrow.x,
        z = arrow.z,
        angle = arrow.angle;
      if (a !== b && after) {
        x += (after.x - x) * fraction;
        z += (after.z - z) * fraction;
        angle += turn(angle, after.angle) * fraction;
      } else if (previous) {
        const before = index(previous).get(arrow.id);
        const seconds = (stamp(latest) - stamp(previous)) / 1000;
        const ahead = clamp((this.time - stamp(latest)) / 1000, 0, 0.1);
        // Brief packet gaps can be bridged with measured velocity. Never
        // predict a bounce/ricochet/return turn or an implausible teleport.
        if (
          before &&
          seconds > 0 &&
          seconds <= 0.25 &&
          Math.abs(turn(before.angle, angle)) < 0.15 &&
          Math.hypot(x - before.x, z - before.z) / seconds <= 43
        ) {
          const edge = RULES.size / 2;
          const endX = clamp(
            x + ((x - before.x) / seconds) * ahead,
            -edge,
            edge,
          );
          const endZ = clamp(
            z + ((z - before.z) / seconds) * ahead,
            -edge,
            edge,
          );
          let stop = 1;
          for (const obstacle of obstacles) {
            if (obstacle.type === "bush") continue;
            const hit = segmentFraction(
              x,
              z,
              endX,
              endZ,
              obstacle.x,
              obstacle.z,
              obstacle.r,
            );
            if (hit !== null) stop = Math.min(stop, hit);
          }
          x += (endX - x) * stop;
          z += (endZ - z) * stop;
        }
      }
      result.push({ ...authoritative, x, z, angle });
    }
    return result;
  }
}

/** Practice has exact consecutive ticks, so no network delay/clock is needed. */
export function localProjectiles(previous, current, fraction) {
  if (!previous) return current.arrows;
  const old = index(previous);
  const t = clamp(fraction, 0, 1);
  return current.arrows.map((arrow) => {
    const before = old.get(arrow.id);
    return before
      ? {
          ...arrow,
          x: before.x + (arrow.x - before.x) * t,
          z: before.z + (arrow.z - before.z) * t,
          angle: before.angle + turn(before.angle, arrow.angle) * t,
        }
      : arrow;
  });
}
