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
      (result.outcome === "win" ? 25 : result.outcome === "draw" ? 5 : -10),
  );
}
