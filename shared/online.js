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
