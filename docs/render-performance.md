# Rendering performance — 2026-10-21

The renderer now batches repeated geometry instead of submitting each archer
part, arrow and particle separately. Gameplay, room population, scenery,
cosmetics, animations, rare XP, particle capacity, resolution presets and shadow
settings are retained. Simulation/input remain at 30 Hz; snapshots remain at
15 Hz. Active rendering still uses the display's requestAnimationFrame cadence.

## Changes

- Matching archer parts share instanced geometry and materials, with independent
  world transforms, skin colors, walking/turning animation and shadow casters.
  Ground contacts and team markers also use instances. Original hierarchies
  remain available to animation; source meshes are excluded from the draw layer.
- Up to 360 arrows use five draws: shafts and four elemental head materials.
  Elemental emissive colors, geometry and cosmetic trails are preserved.
- All 140 pooled particles retain independent positions, rotation, size, color
  and opacity. Their instance buffer is sorted back to front each frame.
- Static scenery's transforms are frozen after its existing geometry merge.
  The scene updates world transforms once per frame before uploading instances.
- The dashed aim line reuses its distance attribute. Previously,
  `computeLineDistances()` created a fresh attribute/GPU buffer every frame.
  Bow strings upload only when charge changes. Cosmetic comparisons avoid
  serializing every character's equipment each frame.
- The minimap caches its static background, while players, rare gems, shrine
  and buffs keep updating. Unchanged leaderboard rows and label names are reused.

## Before/after measurements

A deterministic renderer fixture used the same map, 16 archers, 120 arrows
covering all four head materials, 140 XP gems (including five rare gems),
replenished particle effects, a 390×844 viewport, DPR 1.5 and 1024px PCF shadows.
Both versions ran in headless Chromium using SwiftShader on the same cloud
machine. The previous source is tagged `backup-before-performance-2026-10-21`
at `1f6a819` and bundled in the workspace backup directory.

| Metric | Before | After |
| --- | ---: | ---: |
| Mean draw calls/frame | 595 | 110 |
| Median draw calls/frame | 591 | 107 |
| GPU geometry resources | 255 | 88 |
| Texture resources | 17 | 17 |
| Median submission time in initial isolated comparison | 10.7 ms | 4.8 ms |

This is about **81% fewer draw calls** and **65% fewer geometry resources**.
Triangle counts remain approximately 35,000 per frame; instancing can submit
additional offscreen vertices rather than omit geometry. Pixel comparisons of
the identical scene showed only about 0.13% of pixels differing by more than
10/255 in a color channel, principally at transparent overlaps/rasterized edges.
No quality preset, shadow resolution, actor count or effect capacity was lowered.

These submission times describe this software-rendered fixture, not iPhone FPS.
Device GPU, thermal state and browser determine actual display FPS. Draw-call
and allocation budgets are deterministic and tested independently of FPS.

## Regression checks

Run `npm test`, `npm run check`, `npm run build`,
`npm run build:cloudflare`, and `npm run test:performance`.
Use `PLAYWRIGHT_ENGINE=webkit` for the Safari/WebKit renderer check.
The performance fixture starts its own temporary Vite server; it exposes no
debug controls in the production app. CI tests Chromium and WebKit.

The fixture verifies desktop/mobile presets including the existing high preset,
all 16 labels and shadows, all 120 arrow heads, 140 gems and five rare halos,
level-up protection effects, bounded draw calls, and **zero new GPU buffers in
steady frames**. Repeated deaths, respawns and cosmetic changes must not increase
geometry/texture counts. Unit checks additionally cover all 360 arrows, all
140 particles, animation matrices, individual colors, removal and pool growth.

Existing suites cover real desktop/mobile play, independent twin sticks,
one-handed auto fire, latency/jitter, compact HUD/card selection, all team
formats, native Cloudflare WebSockets and offline/profile behavior.
