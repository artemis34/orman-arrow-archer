/** Cosmetic terrain regions preserve the shared movement and cover rules. */
export const REGIONS = Object.freeze([
  {
    name: "Kadim kalıntılar",
    x: -23,
    z: -21,
    radius: 13,
    color: 0x858c70,
    types: ["ruin", "rock", "bush", "ruin", "stump"],
  },
  {
    name: "Altın koru",
    x: 23,
    z: -17,
    radius: 14,
    color: 0x8b9c62,
    types: ["tree", "bush", "tree", "log"],
  },
  {
    name: "Sessiz açıklık",
    x: 17,
    z: 24,
    radius: 13,
    color: 0x799e75,
    types: ["stump", "log", "bush", "rock"],
  },
]);
