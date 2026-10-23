/** Cosmetic actions are validated by the authority, outside the movement packet.
 * Fixed symbols only: clients cannot broadcast text, positions or arbitrary HTML.
 */
export const EMOTES = Object.freeze({
  wave: { icon: "👋", name: "Selam" },
  gg: { icon: "👏", name: "Güzel oyun" },
  laugh: { icon: "😄", name: "Gülümse" },
  heart: { icon: "💚", name: "Sevgi" },
  wow: { icon: "😮", name: "Şaşkın" },
  target: { icon: "🎯", name: "Tam isabet" },
});
export const EMOTE_RULES = Object.freeze({
  cooldown: 4,
  duration: 2,
  maxPending: 24,
});
const nextAllowed = new WeakMap();
const pending = new WeakMap();

export function sendEmote(world, id, key) {
  const player = world.players.get(id);
  if (
    typeof key !== "string" ||
    !Object.hasOwn(EMOTES, key) ||
    !player?.alive ||
    !world.mode.combat ||
    world.time < (nextAllowed.get(player) ?? -Infinity)
  )
    return false;
  const queue = pending.get(world) || [];
  if (queue.length >= EMOTE_RULES.maxPending) return false;
  // Sending a visible reaction reveals a bush camper for the bubble's duration.
  player.hidden = false;
  player.revealUntil = Math.max(
    player.revealUntil || 0,
    world.time + EMOTE_RULES.duration,
  );
  nextAllowed.set(player, world.time + EMOTE_RULES.cooldown);
  queue.push({ type: "emote", owner: id, key });
  pending.set(world, queue);
  return true;
}

/** Drain after the simulation step, which resets world.events on entry. */
export function drainEmotes(world) {
  const queue = pending.get(world);
  if (!queue) return [];
  pending.delete(world);
  return queue.filter((event) => world.players.get(event.owner)?.alive);
}
