import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";

function fixture() {
  const w = new World({ bots: 0 });
  w.obstacles = [];
  w.obstacleGrid.clear();
  const p = w.addPlayer("me"),
    a = w.addPlayer("chosen"),
    b = w.addPlayer("weak");
  for (const [i, q] of [p, a, b].entries())
    Object.assign(q, { x: 0, z: i * 5, spawnShield: 0 });
  b.hp = 1;
  return { w, p, a, b };
}
test("explicit target wins over a weaker opponent until unlocked", () => {
  const { w, p, a, b } = fixture();
  w.setInput(p.id, { lockTarget: a.id });
  w.step();
  assert.equal(p.autoTargetId, a.id);
  assert.equal(p.lockedTargetId, a.id);
  w.setInput(p.id, {});
  w.step();
  assert.equal(
    p.lockedTargetId,
    a.id,
    "a one-shot preference persists across ordinary inputs",
  );
  w.setInput(p.id, { lockTarget: null });
  w.step();
  assert.equal(p.autoTargetId, b.id);
  assert.equal(p.lockedTargetId, null);
});
test("dead, distant, concealed, protected and covered targets cannot retain a lock", () => {
  for (const reason of ["dead", "far", "hidden", "guard", "shield", "cover"]) {
    const { w, p, a, b } = fixture();
    if (reason === "dead") a.alive = false;
    if (reason === "far") a.z = 35;
    if (reason === "hidden") a.hidden = true;
    if (reason === "guard") a.levelGuard = 3;
    if (reason === "shield") a.spawnShield = 3;
    if (reason === "cover") {
      a.x = 6;
      w.obstacles.push({ type: "rock", x: 3, z: 2.5, r: 1 });
    }
    w.setInput(p.id, { lockTarget: a.id });
    w.step();
    assert.equal(p.lockedTargetId, null, reason);
    assert.equal(p.autoTargetId, b.id, reason);
  }
});
test("population balancing fills eight seats, removes bots for humans and never removes humans", () => {
  const w = new World({ bots: 0 });
  for (let humans = 1; humans <= 16; humans++) {
    w.setBotCount(Math.max(0, 8 - humans));
    assert.ok(w.addPlayer(`human-${humans}`));
    assert.equal(
      [...w.players.values()].filter((p) => p.bot).length,
      Math.max(0, 8 - humans),
    );
    assert.equal([...w.players.values()].filter((p) => !p.bot).length, humans);
  }
  for (let humans = 16; humans > 1; humans--) {
    w.removePlayer(`human-${humans}`);
    w.setBotCount(Math.max(0, 8 - (humans - 1)));
  }
  assert.equal(w.players.size, 8);
  assert.ok(w.players.has("human-1"));
});
