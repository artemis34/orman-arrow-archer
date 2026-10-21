import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const SCENARIOS = [
  { id: "arena-8", format: "arena", humans: 8, bots: 0, seconds: 30 },
  { id: "team-16", format: "t8", humans: 16, bots: 0, seconds: 30 },
  { id: "team-bots", format: "t8", humans: 1, bots: 15, seconds: 30 },
];
export async function modules(root) {
  const read = (path) => import(pathToFileURL(resolve(root, path)).href);
  const [world, protocol, modes, transport, websocket] = await Promise.all([
    read("shared/world.js"),
    read("shared/protocol.js"),
    read("shared/modes.js"),
    read("client/transport.js"),
    read("client/websocket.js"),
  ]);
  return { ...world, ...protocol, ...modes, ...transport, ...websocket };
}
export function makeRoom(api, scenario) {
  const world = new api.World({
    seed: 7821,
    bots: scenario.bots,
    mode: api.createMode(scenario.format),
  });
  const ids = Array.from({ length: scenario.humans }, (_, i) => `player-${i}`);
  for (const [i, id] of ids.entries())
    world.addPlayer(id, `Okçu ${i} 🏹`, i % 4);
  return {
    world,
    ids,
    encoders: ids.map(() => new api.SnapshotEncoder()),
    events: [],
    inputs: ids.map(() => []),
  };
}
export function advance(room, tick) {
  const { world, ids } = room;
  for (const p of world.players.values()) {
    if (!p.alive && p.respawnAt <= world.time) world.respawn(p.id);
    if (p.pending && p.choices.length)
      world.choose(p.id, p.choices[(tick + p.id.length) % p.choices.length]);
  }
  const frames = ids.map((id, i) => {
    const p = world.players.get(id),
      phase = tick / 110 + i * 0.45;
    const dx = Math.cos(phase) * 12 - p.x,
      dz = Math.sin(phase) * 12 - p.z,
      length = Math.hypot(dx, dz) || 1;
    const input = {
      seq: tick + 1,
      x: dx / length,
      z: dz / length,
      angle: phase,
      autoFire: true,
      charge: tick % 90 < 23,
      dash: tick % 109 === i,
      heal: tick % 173 === i,
    };
    world.setInput(id, input);
    return input;
  });
  world.step();
  room.events.push(...world.events);
  return frames;
}
export function publish(api, room, onState = () => {}) {
  const { world, ids, encoders } = room;
  let bytes = 0,
    messages = 0;
  for (let i = 0; i < ids.length; i++) {
    const state = world.snapshot(ids[i], room.events, { radius: 34 });
    const packet = encoders[i].encode(state);
    bytes += packet.byteLength;
    messages++;
    onState(state, packet, i);
  }
  room.events.length = 0;
  return { bytes, messages };
}
