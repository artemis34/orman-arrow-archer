import { FORMATS, formatKey } from "./modes.js";
/** Team formats keep all sides populated even when a friend party fills one side. */
export function populationFor(format) {
  const rules = FORMATS[formatKey(format)];
  return rules.duel
    ? 0
    : rules.teams || rules.battleRoyale
      ? rules.capacity
      : ONLINE.roomPopulation;
}
export const practiceBots = (format) =>
  FORMATS[formatKey(format)].duel ? 1 : populationFor(format) - 1;
/** Public room codes are URL-safe and deterministic across client and server. */
export function roomCode(value = "arena") {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{2,23}$/.test(code) ? code : null;
}
export const ONLINE = Object.freeze({
  humans: 16,
  snapshots: 15,
  interestRadius: 34,
  publicRooms: 128,
  roomPopulation: 8,
  reservationTime: 15000,
  inputTimeout: 350,
  drawTimeout: 1500,
  idleTimeout: 90000,
  maxMessage: 4096,
});

/** Stop stale movement promptly, but freeze a valid draw through brief stalls.
 * Only fresh input may release it; a long absence discards it without firing.
 */
export function pauseStaleInput(player, age) {
  if (age <= ONLINE.inputTimeout) return;
  player.inputStale = true;
  player.input = {
    ...player.input,
    x: 0,
    z: 0,
    dash: false,
    heal: false,
    quickShot: false,
    autoFire: false,
  };
  if (age > ONLINE.drawTimeout) {
    player.input.charge = false;
    player.charge = 0;
  }
}

const EDGE_KEYS = ["dash", "heal", "quickShot", "cancelShot"];
/** Fold a skipped input's one-shot actions into the one that follows it. */
function mergeSkipped(skipped, next) {
  for (const key of EDGE_KEYS) next[key] ||= skipped[key];
  if (next.lockTarget === undefined) next.lockTarget = skipped.lockTarget;
}
/** Take this tick's input from a session's jitter buffer.
 *
 * Inputs arrive in bursts (two per packet, plus network jitter) and the
 * authority consumes one per tick. A burst after a stall used to leave a
 * standing queue of up to six ticks, i.e. ~200 ms of extra latency that never
 * drained. Track the smallest queue seen over one second: in steady play it
 * dips to one input before each packet arrives. Anything above two is standing
 * latency, so the surplus is skipped at once (dash/heal/shot presses are kept).
 * Short bursts that drain by themselves are left untouched.
 */
export function takeQueuedInput(session, tick = 30) {
  const queue = (session.inputs ||= []);
  session.minQueue = Math.min(session.minQueue ?? Infinity, queue.length);
  session.queueTicks = (session.queueTicks || 0) + 1;
  if (session.queueTicks >= tick) {
    for (let surplus = session.minQueue - 2; surplus > 0; surplus--)
      mergeSkipped(queue.shift(), queue[0]);
    session.minQueue = Infinity;
    session.queueTicks = 0;
  }
  return queue.shift();
}
/** Keep at most `limit` queued inputs; older ones fold into their successor. */
export function boundQueuedInputs(queue, limit = 6) {
  while (queue.length > limit) mergeSkipped(queue.shift(), queue[0]);
}
