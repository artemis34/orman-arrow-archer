import { updateRank } from "./ranking.js";
/** Cosmetic currency is earned through completed, authoritative online rounds. */
export const CATALOG = Object.freeze([
  { id: "bow-oak", slot: "bow", name: "Meşe yayı", color: "#e7bf79", price: 0 },
  { id: "bow-moon", slot: "bow", name: "Ay yayı", color: "#bddaff", price: 80 },
  {
    id: "bow-ember",
    slot: "bow",
    name: "Köz yayı",
    color: "#ffa478",
    price: 100,
  },
  {
    id: "cape-forest",
    slot: "cape",
    name: "Orman pelerini",
    color: "#244b42",
    price: 0,
  },
  {
    id: "cape-moon",
    slot: "cape",
    name: "Gece pelerini",
    color: "#58619f",
    price: 90,
  },
  {
    id: "cape-sun",
    slot: "cape",
    name: "Günbatımı pelerini",
    color: "#ba734b",
    price: 90,
  },
  {
    id: "hood-forest",
    slot: "hood",
    name: "İzci başlığı",
    color: "#244b42",
    price: 0,
  },
  {
    id: "hood-moon",
    slot: "hood",
    name: "Ay başlığı",
    color: "#8982bd",
    price: 70,
  },
  {
    id: "trail-leaf",
    slot: "trail",
    name: "Yaprak izi",
    color: "#bde08d",
    price: 0,
  },
  {
    id: "trail-spark",
    slot: "trail",
    name: "Kıvılcım izi",
    color: "#ffb176",
    price: 100,
  },
  {
    id: "trail-mist",
    slot: "trail",
    name: "Sis izi",
    color: "#9edcfa",
    price: 100,
  },
  {
    id: "spawn-leaf",
    slot: "spawn",
    name: "Orman doğuşu",
    color: "#bde08d",
    price: 0,
  },
  {
    id: "spawn-moon",
    slot: "spawn",
    name: "Ay doğuşu",
    color: "#c6bdff",
    price: 120,
  },
  {
    id: "frame-plain",
    slot: "frame",
    name: "Sade çerçeve",
    color: "#bde08d",
    price: 0,
  },
  {
    id: "frame-gold",
    slot: "frame",
    name: "Altın çerçeve",
    color: "#f3cf7e",
    price: 120,
  },
  {
    id: "pose-salute",
    slot: "pose",
    name: "Okçu selamı",
    color: "#bde08d",
    price: 0,
  },
  {
    id: "pose-victory",
    slot: "pose",
    name: "Zafer pozu",
    color: "#ffd278",
    price: 80,
  },
]);
export const starter = () =>
  Object.fromEntries(
    CATALOG.filter((p) => !p.price).map((p) => [p.slot, p.id]),
  );
export function newProfile() {
  return {
    version: 1,
    socialCode: crypto
      .randomUUID()
      .replaceAll("-", "")
      .slice(0, 12)
      .toUpperCase(),
    displayName: "Gezgin",
    ranked: { points: 0, matches: 0, wins: 0 },
    coins: 0,
    owned: CATALOG.filter((p) => !p.price).map((p) => p.id),
    equipped: starter(),
    stats: {
      matches: 0,
      kills: 0,
      assists: 0,
      hits: 0,
      wins: 0,
      objectives: 0,
      best: 0,
    },
    achievements: [],
    receipts: [],
  };
}
export const ACHIEVEMENTS = Object.freeze([
  {
    id: "first",
    name: "İlk iz",
    text: "Bir online maç tamamla",
    stat: "matches",
    value: 1,
    coins: 30,
  },
  {
    id: "regular",
    name: "Ormanın konuğu",
    text: "Üç online maç tamamla",
    stat: "matches",
    value: 3,
    item: "cape-moon",
  },
  {
    id: "marksman",
    name: "İsabet ustası",
    text: "30 ok isabeti",
    stat: "hits",
    value: 30,
    item: "bow-moon",
  },
  {
    id: "shrine",
    name: "Sunak koruyucusu",
    text: "Üç sunak ele geçir",
    stat: "objectives",
    value: 3,
    item: "spawn-moon",
  },
]);
export function purchase(profile, id) {
  const item = CATALOG.find((p) => p.id === id);
  if (!item) return { error: "Görünüş bulunamadı." };
  if (profile.owned.includes(id)) return { ok: true };
  if (profile.coins < item.price)
    return {
      error: "Yeterli yaprak yok. Online maç tamamlayarak kazanabilirsin.",
    };
  profile.coins -= item.price;
  profile.owned.push(id);
  return { ok: true };
}
export function equip(profile, id) {
  const item = CATALOG.find((p) => p.id === id);
  if (!item || !profile.owned.includes(id))
    return { error: "Bu görünüş henüz koleksiyonunda değil." };
  profile.equipped[item.slot] = id;
  return { ok: true };
}
/** Receipts come only from an ArenaRoom, never the browser. Replays award once. */
export function award(profile, result) {
  if (
    typeof result.receipt !== "string" ||
    profile.receipts.includes(result.receipt)
  )
    return false;
  const safe = (v) => Math.max(0, Math.min(1000, Math.floor(Number(v) || 0)));
  profile.receipts.push(result.receipt);
  profile.receipts = profile.receipts.slice(-64);
  profile.stats.matches++;
  if (!result.statsRecorded)
    for (const key of ["kills", "assists", "hits", "objectives"])
      profile.stats[key] += safe(result[key]);
  profile.stats.wins += result.win ? 1 : 0;
  profile.stats.best = Math.max(profile.stats.best, safe(result.points));
  updateRank(profile, result);
  profile.coins +=
    20 + Math.min(20, safe(result.kills) * 2) + (result.win ? 10 : 0);
  for (const a of ACHIEVEMENTS) {
    if (profile.achievements.includes(a.id) || profile.stats[a.stat] < a.value)
      continue;
    profile.achievements.push(a.id);
    if (a.coins) profile.coins += a.coins;
    if (a.item && !profile.owned.includes(a.item)) profile.owned.push(a.item);
  }
  return true;
}
export function recordActivity(profile, result) {
  if (
    typeof result.receipt !== "string" ||
    profile.receipts.includes(result.receipt)
  )
    return false;
  profile.receipts.push(result.receipt);
  profile.receipts = profile.receipts.slice(-64);
  for (const key of ["kills", "assists", "hits", "objectives"])
    profile.stats[key] += Math.max(
      0,
      Math.min(1000, Math.floor(Number(result[key]) || 0)),
    );
  return true;
}
export function publicProfile(profile) {
  const { receipts, ...view } = profile;
  return structuredClone(view);
}
export function sanitizeCosmetics(profile, requested = {}) {
  const equipped = { ...starter() };
  for (const [slot, id] of Object.entries(profile?.equipped || requested || {}))
    if (
      CATALOG.some((p) => p.slot === slot && p.id === id) &&
      (profile
        ? profile.owned.includes(id)
        : !CATALOG.find((p) => p.id === id).price)
    )
      equipped[slot] = id;
  return equipped;
}
export const validToken = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export async function profileId(token) {
  if (!validToken(token)) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
