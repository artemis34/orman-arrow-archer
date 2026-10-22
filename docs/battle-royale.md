# Solo Battle Royale

Choose **Battle Royale · Herkes tek** under Karşılaşma. Both multiplayer and
practice use the same authoritative `BattleRoyale` rules. Capacity is 16; empty
waiting-room seats are filled with bots. There are no teams or same-round
respawns. A 12-second preparation countdown lets more humans join; a full human
roster starts immediately. Active rounds reject late joins, and quick matchmaking
allocates another waiting room instead. Disconnects never spawn replacements
during combat.

The initial safe circle (radius 60) covers all corners of the existing 84-unit
square map. After 20 seconds it contracts smoothly through radii
60 → 42 → 28 → 16 → 7 → 0, in five 35-second stages. Outside damage ticks once per
second on the authority (5 / 8 / 12 / 18 / 30 damage for successive stages).
Existing spawn and level-selection protection still apply. The final storm also
damages the exact centre; a simultaneous final elimination is a draw. Bots use
their existing cover navigation to head into the safe circle.

The last survivor wins, regardless of kill score. Results list survival placement;
profile victory rewards use the survivor ID. Between rounds, all participants
reset to level 1, the circle resets, and departed seats can be replenished. Normal
arena, team, duel and ranked rules remain unchanged.

The existing protocol version, input flags and player tuples are unchanged.
Optional `match.zone` metadata contains `x`, `z`, `radius`, `damage`, `shrinking`
and `remaining` (initial safe-time countdown). `match.survivors`, `match.winnerId`
and result-row `placement` supply the rest of the UI. Native clients should draw
this state; they must not compute authoritative storm damage. The web view uses
two reused meshes and adds the circle to the existing minimap/status display.

Validation:

- `npm test`: waiting/start, FFA targeting, late joins, no respawn/refill, shrinking
  and storm ticks, survivor-based winner, draw, rematch and binary round trip.
- `npm run test:battle-royale`: two browser clients, storm UI/damage, short ability
  cards, winner placement and rematch (Chromium and `PLAYWRIGHT_ENGINE=webkit`).
- `npm run test:multimode`: the real Durable Object runtime, including a full
  16-human BR roster, capacity enforcement and room cleanup.
