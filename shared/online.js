/** Public room codes are URL-safe and deterministic across client and server. */
export function roomCode(value = "arena") {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{2,23}$/.test(code) ? code : null;
}
export const ONLINE = Object.freeze({
  humans: 16,
  snapshots: 15,
  inputTimeout: 350,
  idleTimeout: 90000,
  maxMessage: 4096,
});
