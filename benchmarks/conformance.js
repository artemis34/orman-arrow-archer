import { createHash } from "node:crypto";
import { SCENARIOS, modules, makeRoom, advance, publish } from "./workload.js";

export async function traces(root, { legacyRoster = false } = {}) {
  const api = await modules(root),
    results = [];
  for (const scenario of SCENARIOS) {
    const room = makeRoom(api, scenario),
      physics = createHash("sha256"),
      json = createHash("sha256"),
      wire = createHash("sha256"),
      decoded = createHash("sha256");
    const decoders = room.ids.map(() => new api.SnapshotDecoder());
    // Compare the captured pre-streak view without its new optional HUD-only
    // roster key. Physics, input bytes and every existing snapshot field stay
    // in the original trace; dedicated streak tests cover the new metadata.
    if (legacyRoster) {
      const snapshot = room.world.snapshot.bind(room.world);
      room.world.snapshot = (...args) => {
        const state = snapshot(...args);
        for (const p of state.roster) delete p.killStreak;
        return state;
      };
    }
    let bytes = 0,
      messages = 0,
      hits = 0,
      kills = 0,
      shots = 0,
      legacyBytes = 0,
      inputBytes = 0,
      inputMessages = 0;
    const inputWire = createHash("sha256");
    const clients = room.ids.map(() => {
      const t = new api.WebSocketTransport(
        "https://fixture.invalid",
        () => {},
        () => {},
      );
      t.binary = true;
      t.ws = {
        readyState: 1,
        bufferedAmount: 0,
        send(packet) {
          inputBytes += packet.byteLength;
          inputMessages++;
          inputWire.update(new Uint8Array(packet));
        },
      };
      return t;
    });
    for (let tick = 0; tick < scenario.seconds * 30; tick++) {
      const inputs = advance(room, tick);
      inputs.forEach((input, i) => clients[i].send("input", input));
      physics.update(
        JSON.stringify(
          {
            time: room.world.time,
            seed: room.world.seed,
            players: [...room.world.players.values()],
            arrows: room.world.arrows.active,
            orbs: room.world.orbs.active,
            events: room.world.events,
          },
          (key, value) =>
            value instanceof Map || value instanceof Set ? [...value] : value,
        ),
      );
      for (const event of room.world.events) {
        if (event.type === "hit") hits++;
        if (event.type === "kill") kills++;
        if (event.type === "shot") shots++;
      }
      if (tick % 2 === 1)
        publish(api, room, (state, packet, i) => {
          json.update(JSON.stringify(state));
          wire.update(new Uint8Array(packet));
          decoded.update(JSON.stringify(decoders[i].decode(packet)));
          bytes += packet.byteLength;
          messages++;
          legacyBytes += Buffer.byteLength(
            JSON.stringify({ type: "state", data: state }),
          );
        });
    }
    results.push({
      id: scenario.id,
      physics: physics.digest("hex"),
      json: json.digest("hex"),
      wire: wire.digest("hex"),
      decoded: decoded.digest("hex"),
      inputWire: inputWire.digest("hex"),
      bytes,
      messages,
      legacyBytes,
      inputBytes,
      inputMessages,
      hits,
      kills,
      shots,
    });
  }
  // Reference interpolation with changing buffers, guards, deaths, removal,
  // teleports and angle wrapping. No prediction/cadence math is modified.
  const original = performance.now;
  let now = 0;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => now,
  });
  const views = createHash("sha256");
  try {
    const transport = new api.NetworkTransport(
      () => {},
      () => {},
    );
    transport.id = "local";
    transport.obstacles = [];
    transport.send = () => {};
    for (let i = 0; i < 100; i++) {
      now = i * 66 + (i % 4) * 3;
      const player = (id, j) => ({
        id,
        x: i * 0.07 + j,
        z: Math.sin(i / 3) * 3,
        angle: i * 0.6,
        hp: 150 - i / 4,
        alive: i % 23 !== 0,
        levelGuard: i % 17 === 0 ? 3 : 0,
        dashCd: 0,
        dashTime: 0,
        seq: i,
        upgrades: {},
        ...(i === 40 || i === 41 ? { x: 30 } : {}),
      });
      const players = [player("local", 0), player("remote", 4)];
      if (i % 11) players.push(player("hidden", 7));
      transport.acceptState({
        time: i / 15,
        players,
        arrows: i % 7 ? [{ id: "a", x: i / 3, z: 2, angle: 0 }] : [],
        events: [],
        orbs: [],
      });
      transport.step({ x: i % 3 ? 1 : 0, z: i % 4 ? 0 : 1 });
      for (let f = 0; f < 8; f++) {
        now += 1000 / 120;
        views.update(JSON.stringify(transport.view()));
      }
    }
  } finally {
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: original,
    });
  }
  return { scenarios: results, clientViews: views.digest("hex") };
}
