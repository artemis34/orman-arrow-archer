/** Placement is a provider hint, not a guaranteed physical datacenter.
 * Existing/global room IDs remain valid; new quick rooms include their region.
 */
export const REGIONS = Object.freeze([
  "wnam",
  "enam",
  "sam",
  "weur",
  "eeur",
  "apac",
  "oc",
  "afr",
]);
export const validRegion = (value) => (REGIONS.includes(value) ? value : "");
export const alternateRegion = (region) =>
  ({ eeur: "weur", weur: "eeur" })[region] || "";
const eastern = new Set([
  "TR",
  "CY",
  "GR",
  "BG",
  "RO",
  "MD",
  "UA",
  "PL",
  "HU",
  "SK",
  "CZ",
  "RS",
  "BA",
  "ME",
  "MK",
  "AL",
  "HR",
  "SI",
  "EE",
  "LV",
  "LT",
  "GE",
  "AM",
  "AZ",
  "IL",
  "JO",
  "LB",
  "IQ",
  "IR",
  "SA",
  "AE",
  "QA",
  "KW",
  "OM",
  "BH",
]);
export function requestRegion(cf) {
  if (!cf) return "";
  if (eastern.has(cf.country)) return "eeur";
  if (cf.continent === "NA")
    return Number(cf.longitude) < -105 ? "wnam" : "enam";
  return (
    { EU: "weur", SA: "sam", AS: "apac", OC: "oc", AF: "afr" }[cf.continent] ||
    ""
  );
}
export const roomRegion = (code) =>
  validRegion(/(?:^|-)wildbow-([a-z]+)-\d+$/.exec(code || "")?.[1]);
export const publicRoom = (code) =>
  /(?:^|-)wildbow-\d+$/.test(code || "") || !!roomRegion(code);
export const directoryName = (format, region = "") =>
  (format && format !== "arena" ? `public:${format}` : "public") +
  (region ? `:${region}` : "");
export function located(namespace, name, region = "") {
  const id = namespace.idFromName(name);
  return region
    ? namespace.get(id, { locationHint: region })
    : namespace.get(id);
}
export const arenaStub = (env, code) =>
  located(env.ARENAS, code, roomRegion(code));
