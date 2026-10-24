/** Prepare shaders before play, without leaving Three's uncancellable poll behind.
 * compile() is public; optional program bindings are guarded for Three upgrades.
 * Only polling is time-bounded: synchronous driver calls still run normally.
 */
export async function warmupRenderer(
  renderer,
  scene,
  camera,
  {
    budgetMs = 4000,
    now = () => performance.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const gl = renderer.getContext();
  if (gl.isContextLost()) return false;
  const budget = Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : 4000;
  const deadline = now() + budget;
  renderer.compile(scene, camera);
  const programs = renderer.info?.programs?.slice();
  // A future renderer may stop exposing readiness. Leave its normal rendering
  // path in control rather than waiting forever or probing unready programs.
  if (
    !programs ||
    programs.some((program) => typeof program.isReady !== "function")
  )
    return false;
  for (;;) {
    if (gl.isContextLost() || now() >= deadline) return false;
    if (programs.every((program) => program.isReady())) {
      for (const program of programs) {
        if (gl.isContextLost()) return false;
        program.getUniforms?.();
        program.getAttributes?.();
      }
      return true;
    }
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    // There is only one awaited timer. Returning on timeout/context loss
    // therefore leaves no background polling callbacks or retained materials.
    await sleep(Math.min(16, remaining));
  }
}
