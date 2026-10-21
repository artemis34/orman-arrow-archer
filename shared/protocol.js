/** Versioned, dependency-free binary packets shared by Workers and browsers. */
export const PROTOCOL = 2;
const text = new TextEncoder(),
  utf8 = new TextDecoder();
// Repeated field names/IDs are immutable UTF-8 values. Keep a small FIFO cache,
// bounded in both entry count and string length; packet outputs still copy bytes.
const encodedStrings = new Map();
function stringBytes(value) {
  let bytes = encodedStrings.get(value);
  if (bytes) return bytes;
  bytes = text.encode(value);
  if (value.length <= 128) {
    if (encodedStrings.size >= 256)
      encodedStrings.delete(encodedStrings.keys().next().value);
    encodedStrings.set(value, bytes);
  }
  return bytes;
}
export function encodePacket(value) {
  const bytes = [87, 66, PROTOCOL];
  // Packet-local scratch: outputs still own their bytes and nested encodes
  // cannot overwrite another packet. Integer-only packets allocate no scratch.
  let floatBytes, floatView;
  const uint = (v) => {
    do {
      const b = v % 128;
      v = Math.floor(v / 128);
      bytes.push(b | (v ? 128 : 0));
    } while (v);
  };
  const write = (v) => {
    if (v == null) bytes.push(0);
    else if (typeof v === "boolean") bytes.push(v ? 2 : 1);
    else if (typeof v === "number") {
      if (Number.isSafeInteger(v) && Math.abs(v) < 1e12) {
        bytes.push(3);
        uint(v >= 0 ? v * 2 : -v * 2 - 1);
      } else {
        bytes.push(4);
        if (!floatBytes) {
          floatBytes = new Uint8Array(8);
          floatView = new DataView(floatBytes.buffer);
        }
        floatView.setFloat64(0, Number.isFinite(v) ? v : 0, true);
        bytes.push(...floatBytes);
      }
    } else if (typeof v === "string") {
      const b = stringBytes(v);
      bytes.push(5);
      uint(b.length);
      for (const n of b) bytes.push(n);
    } else if (Array.isArray(v)) {
      bytes.push(6);
      uint(v.length);
      for (const n of v) write(n);
    } else {
      const entries = Object.entries(v);
      bytes.push(7);
      uint(entries.length);
      for (const [k, n] of entries) {
        write(k);
        write(n);
      }
    }
  };
  write(value);
  return Uint8Array.from(bytes).buffer;
}
export function decodePacket(buffer) {
  const b =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let at = 3;
  let floatView;
  if (b.length > 262144 || b[0] !== 87 || b[1] !== 66 || b[2] !== PROTOCOL)
    throw new Error("Unsupported packet");
  const byte = () => {
    if (at >= b.length) throw new Error("Truncated packet");
    return b[at++];
  };
  const uint = () => {
    let n = 0,
      scale = 1;
    for (let i = 0; i < 6; i++) {
      const v = byte();
      n += (v & 127) * scale;
      if (!(v & 128)) return n;
      scale *= 128;
    }
    throw new Error("Invalid integer");
  };
  const read = (depth = 0) => {
    if (depth > 12) throw new Error("Packet nesting limit");
    const tag = byte();
    if (tag === 0) return null;
    if (tag === 1 || tag === 2) return tag === 2;
    if (tag === 3) {
      const v = uint();
      return v % 2 ? -(v + 1) / 2 : v / 2;
    }
    if (tag === 4) {
      if (at + 8 > b.length) throw new Error("Truncated number");
      floatView ||= new DataView(b.buffer, b.byteOffset, b.byteLength);
      const v = floatView.getFloat64(at, true);
      at += 8;
      return v;
    }
    if (tag === 5) {
      const n = uint();
      if (at + n > b.length) throw new Error("Truncated string");
      const v = utf8.decode(b.subarray(at, at + n));
      at += n;
      return v;
    }
    if (tag === 6 || tag === 7) {
      const n = uint();
      if (n > 16384) throw new Error("Packet collection limit");
      if (tag === 6) return Array.from({ length: n }, () => read(depth + 1));
      const result = Object.create(null);
      for (let i = 0; i < n; i++) {
        const key = read(depth + 1);
        if (typeof key !== "string") throw new Error("Invalid key");
        result[key] = read(depth + 1);
      }
      return result;
    }
    throw new Error("Invalid packet tag");
  };
  const value = read();
  if (at !== b.length) throw new Error("Trailing packet data");
  return value;
}
const fields = [
  ["name"],
  ["skin"],
  ["x", 100],
  ["z", 100],
  ["vx", 100],
  ["vz", 100],
  ["angle", 1000],
  ["hp", 100],
  ["maxHp"],
  ["level"],
  ["xp"],
  ["kills"],
  ["score"],
  ["alive"],
  ["charge", 1000],
  ["levelGuard", 1000],
  ["buffType"],
  ["buffTime", 1000],
  ["autoTargetId"],
  ["slowTime", 1000],
  ["slowImmunity", 1000],
  ["shotCd", 1000],
  ["dashCd", 1000],
  ["healCd", 1000],
  ["dashTime", 1000],
  ["dashX", 1000],
  ["dashZ", 1000],
  ["upgrades"],
  ["choices"],
  ["pending"],
  ["hidden"],
  ["spawnShield", 1000],
  ["seq"],
  ["respawnIn", 1000],
  ["bot"],
  ["lockedTargetId"],
  ["team"],
  ["cosmetics"],
  ["assists"],
  ["matchPoints"],
  ["rerolled"],
  ["lastDeath"],
];
const q = (n, scale = 100) => Math.round((n || 0) * scale);
const playerValues = (p) =>
  fields.map(([key, scale]) =>
    scale
      ? q(p[key], scale)
      : typeof p[key] === "object" && p[key] !== null
        ? structuredClone(p[key])
        : (p[key] ?? null),
  );
const equal = (a, b) =>
  typeof a === "object" || typeof b === "object"
    ? JSON.stringify(a) === JSON.stringify(b)
    : a === b;

/** Reliable ordered WebSockets allow per-connection deltas, with periodic keyframes. */
export class SnapshotEncoder {
  players = new Map();
  orbs = new Map();
  count = 0;
  roster = "";
  encode(state) {
    const reset = this.count++ % 75 === 0;
    if (reset) {
      this.players.clear();
      this.orbs.clear();
    }
    const added = [],
      changed = [],
      removed = [],
      seen = new Set();
    for (const p of state.players) {
      seen.add(p.id);
      const values = playerValues(p),
        old = this.players.get(p.id);
      if (!old) added.push([p.id, ...values]);
      else {
        const patch = [p.id];
        values.forEach((v, i) => {
          if (!equal(v, old[i])) patch.push(i, v);
        });
        if (patch.length > 1) changed.push(patch);
      }
      this.players.set(p.id, values);
    }
    for (const id of this.players.keys())
      if (!seen.has(id)) {
        removed.push(id);
        this.players.delete(id);
      }
    const orbAdded = [],
      orbRemoved = [],
      orbSeen = new Set();
    for (const o of state.orbs) {
      orbSeen.add(o.id);
      if (!this.orbs.has(o.id)) {
        orbAdded.push([o.id, q(o.x), q(o.z), o.value, o.rare]);
        this.orbs.set(o.id, true);
      }
    }
    for (const id of this.orbs.keys())
      if (!orbSeen.has(id)) {
        orbRemoved.push(id);
        this.orbs.delete(id);
      }
    const rosterKey = JSON.stringify(state.roster || []);
    const roster =
      reset || rosterKey !== this.roster ? state.roster || [] : null;
    this.roster = rosterKey;
    return encodePacket([
      "state",
      reset,
      q(state.time, 1000),
      added,
      changed,
      removed,
      state.arrows.map((a) => [
        a.id,
        q(a.x),
        q(a.z),
        q(a.angle, 1000),
        a.poison,
        a.effect,
        a.trail,
      ]),
      orbAdded,
      orbRemoved,
      state.powerups,
      state.events,
      roster,
      state.match || null,
      state.objective || null,
    ]);
  }
}
export class SnapshotDecoder {
  players = new Map();
  orbs = new Map();
  roster = [];
  decode(buffer) {
    const p = decodePacket(buffer);
    if (!Array.isArray(p) || p[0] !== "state" || p.length !== 14)
      throw new Error("Invalid snapshot");
    if (p[1]) {
      this.players.clear();
      this.orbs.clear();
    }
    for (const [id, ...values] of p[3]) this.players.set(id, values);
    for (const [id, ...changes] of p[4]) {
      const values = this.players.get(id);
      if (!values) throw new Error("Missing baseline");
      for (let i = 0; i < changes.length; i += 2)
        values[changes[i]] = changes[i + 1];
    }
    for (const id of p[5]) this.players.delete(id);
    for (const [id, x, z, value, rare] of p[7])
      this.orbs.set(id, { id, x: x / 100, z: z / 100, value, rare });
    for (const id of p[8]) this.orbs.delete(id);
    if (p[11] !== null) this.roster = p[11];
    return {
      time: p[2] / 1000,
      players: [...this.players].map(([id, values]) => {
        const player = { id };
        fields.forEach(([key, scale], i) => {
          player[key] = scale ? values[i] / scale : values[i];
        });
        return player;
      }),
      arrows: p[6].map(([id, x, z, angle, poison, effect, trail]) => ({
        id,
        x: x / 100,
        z: z / 100,
        angle: angle / 1000,
        poison,
        effect,
        trail,
      })),
      orbs: [...this.orbs.values()],
      powerups: p[9] || [],
      events: p[10] || [],
      roster: this.roster,
      match: p[12],
      objective: p[13],
    };
  }
}
const flags = ["charge", "dash", "heal", "quickShot", "cancelShot", "autoFire"];
export function encodeInputs(inputs) {
  return encodePacket([
    "input",
    inputs.map((i) => [
      i.seq,
      q(i.x, 10000),
      q(i.z, 10000),
      q(i.angle, 10000),
      flags.reduce((n, k, bit) => n | (i[k] ? 1 << bit : 0), 0),
      i.lockTarget === undefined ? false : i.lockTarget,
    ]),
  ]);
}
export function decodeInputs(buffer) {
  const p = decodePacket(buffer);
  if (
    !Array.isArray(p) ||
    p[0] !== "input" ||
    !Array.isArray(p[1]) ||
    !p[1].length ||
    p[1].length > 4
  )
    throw new Error("Invalid input batch");
  return p[1].map((a) => {
    if (
      !Array.isArray(a) ||
      a.length !== 6 ||
      !a.slice(0, 5).every(Number.isFinite)
    )
      throw new Error("Invalid input");
    const input = {
      seq: a[0],
      x: a[1] / 10000,
      z: a[2] / 10000,
      angle: a[3] / 10000,
      lockTarget: a[5] === false ? undefined : a[5],
    };
    flags.forEach((key, bit) => (input[key] = !!(a[4] & (1 << bit))));
    return input;
  });
}
