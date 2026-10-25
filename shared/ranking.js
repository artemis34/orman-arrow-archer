export const RANKS = Object.freeze([
  ["Tohum", 0, "◌"],
  ["Filiz", 100, "⌁"],
  ["Fidan", 250, "♧"],
  ["Genç Ağaç", 500, "♣"],
  ["Meşe", 900, "♠"],
  ["Ulu Çınar", 1400, "✦"],
  ["Kadim Orman", 2200, "❋"],
  ["Dünya Ağacı", 3200, "✺"],
]);
export const TITLES = Object.freeze([
  ["Çırak", 0],
  ["İzci", 10],
  ["Avcı", 50],
  ["Nişancı", 150],
  ["Usta Nişancı", 400],
  ["Şahin Gözü", 1000],
  ["Başokçu", 2500],
  ["Efsane Okçu", 5000],
]);
const tier = (list, value) =>
  list.reduce((best, row) => (value >= row[1] ? row : best), list[0]);
export const rankFor = (points = 0) => {
  const [name, min, icon] = tier(RANKS, points);
  return {
    name,
    min,
    icon,
    next: RANKS.find((r) => r[1] > points)?.[1] ?? null,
  };
};
export const titleFor = (kills = 0) => {
  const [name, min] = tier(TITLES, kills);
  return { name, min, next: TITLES.find((r) => r[1] > kills)?.[1] ?? null };
};
export const emptyRating = () => ({ points: 0, matches: 0, wins: 0 });
/** Legacy mixed RP remains archived; it cannot be attributed to either queue. */
export function ensureRatings(profile) {
  profile.ratings ||= {};
  profile.ratings.solo ||= emptyRating();
  profile.ratings.duo ||= emptyRating();
  return profile.ratings;
}
/** Freeze this fraction at the opening roster, never after deaths/disconnects. */
export const ratingScaleFor = (humans, total) =>
  Math.max(0.2, Math.min(1, humans / Math.max(1, total)));
export function ratingDelta(outcome, scale = 1) {
  const base = { win: 25, loss: -10, draw: 5 }[outcome] || 0;
  const weight = Number.isFinite(scale) ? Math.max(0.2, Math.min(1, scale)) : 1;
  return Math.sign(base) * Math.round(Math.abs(base) * weight);
}
/** Fixed 32-player / 16-team cutoffs, independent of kills and client claims. */
export function placementDelta(rankMode, placement, scale = 1) {
  const total = rankMode === "solo" ? 32 : rankMode === "duo" ? 16 : 0;
  if (!Number.isInteger(placement) || placement < 1 || placement > total)
    return null;
  const cutoff = rankMode === "solo" ? 10 : 8;
  const base =
    placement <= cutoff
      ? Math.round(25 - ((placement - 1) * 23) / (cutoff - 1))
      : -Math.round(1 + ((placement - cutoff - 1) * 9) / (total - cutoff - 1));
  const weight = Number.isFinite(scale) ? Math.max(0.2, Math.min(1, scale)) : 1;
  return Math.sign(base) * Math.max(1, Math.round(Math.abs(base) * weight));
}
export function updateRank(profile, result) {
  if (
    !result.ranked ||
    !["solo", "duo"].includes(result.rankMode) ||
    !["win", "loss", "draw"].includes(result.outcome)
  )
    return;
  const rating = ensureRatings(profile)[result.rankMode];
  rating.matches++;
  if (result.outcome === "win") rating.wins++;
  rating.points = Math.max(
    0,
    rating.points +
      (placementDelta(result.rankMode, result.placement, result.ratingScale) ??
        ratingDelta(result.outcome, result.ratingScale)),
  );
}
