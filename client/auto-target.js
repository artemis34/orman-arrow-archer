import { selectTarget } from "../shared/aim.js";
/** Prefer the authority's current target so bow, reticle and auto-fire agree.
 * Hidden/dead/guarded targets still pass the normal visibility/range checks.
 */
export function presentationTarget(me, players, obstacles) {
  for (const id of [me?.lockedTargetId, me?.autoTargetId]) {
    if (!id) continue;
    const target = players.find((p) => p.id === id);
    if (!target) continue;
    const valid = selectTarget(me, [target], obstacles);
    if (valid) return valid;
  }
  return selectTarget(me, players, obstacles);
}
