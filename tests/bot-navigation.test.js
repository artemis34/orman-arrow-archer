import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import { RULES } from "../shared/config.js";
function room() {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  while (w.orbs.active.length) w.orbs.release(0);
  w.powerups.sites = [];
  w.objective.nextAt = Infinity;
  w.spawnOrb = () => {};
  return w;
}
for (const sx of [-1, 1])
  for (const sz of [-1, 1])
    test(`a retreating bot leaves the ${sx},${sz} arena corner instead of pushing the boundary forever`, () => {
      const w = room(),
        p = w.addPlayer("bot", "Bot", 0, true),
        enemy = w.addPlayer("human");
      const edge = RULES.size / 2 - RULES.radius;
      Object.assign(p, {
        x: sx * edge,
        z: sz * edge,
        hp: 20,
        healCd: 999,
        dashCd: 999,
        spawnShield: 999,
      });
      Object.assign(enemy, {
        x: sx * (edge - 8),
        z: sz * (edge - 8),
        spawnShield: 999,
      });
      const start = { x: p.x, z: p.z };
      for (let i = 0; i < 75; i++) {
        const old = { x: p.x, z: p.z };
        w.step();
        assert.ok(Math.abs(p.x) <= edge && Math.abs(p.z) <= edge);
        assert.ok(
          Math.hypot(p.x - old.x, p.z - old.z) <=
            RULES.speed / RULES.tick + 1e-8,
          "recovery must walk, never teleport or grant a dash",
        );
      }
      assert.ok(
        Math.hypot(p.x - start.x, p.z - start.z) > 2,
        "the bot is still frozen at the corner",
      );
    });
test("a gathering bot can get around cover instead of oscillating in its avoidance field", () => {
  const w = room(),
    p = w.addPlayer("bot", "Bot", 0, true);
  Object.assign(p, { x: -3, z: 0 });
  const rock = { id: 1, x: 0, z: 0, r: 1.5, type: "rock" };
  w.obstacles.push(rock);
  w.obstacleGrid.insert(rock, rock.r);
  const gem = w.orbs.acquire();
  Object.assign(gem, {
    id: 99,
    x: 5,
    z: 0,
    value: 12,
    rare: false,
    collected: false,
  });
  for (let i = 0; i < 240 && p.x < 3; i++) {
    w.step();
    assert.ok(Math.hypot(p.x, p.z) >= rock.r + RULES.radius - 1e-8);
  }
  assert.ok(p.x > 3, `bot failed to navigate cover: ${p.x},${p.z}`);
});
