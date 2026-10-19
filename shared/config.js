import skins from "./cosmetics.json" with { type: "json" };
/** Shared rules: client movement prediction and the server use these same constants. */
export const RULES = Object.freeze({
  size: 84,
  tick: 30,
  speed: 7.4,
  playerHealth: 150,
  botHealth: 100,
  playerShield: 4,
  levelGuardDuration: 3,
  frostDuration: 0.65,
  frostImmunity: 2.2,
  frostSlow: 0.18,
  ricochetRange: 6,
  ricochetScale: 0.4,
  blastDamage: 4,
  blastRadius: 2,
  blastCooldown: 1.1,
  longshotRange: 12,
  longshotBonus: 0.2,
  botDamageScale: 0.75,
  arrowDamage: 15,
  shotCooldown: 0.55,
  sideArrowScale: 0.3,
  rearArrowScale: 0.5,
  poisonDps: 1,
  poisonDuration: 3,
  speedPerUpgrade: 0.08,
  drawFactor: 0.88,
  orbXP: 12,
  rareOrbXP: 60,
  rareOrbChance: 0.04,
  maxRareOrbs: 5,
  quickShotCharge: 0.55,
  quickShotCooldown: 0.65,
  autoAimRange: 22,
  radius: 0.62,
  drawTime: 0.85,
  dashCooldown: 3,
  dashDuration: 0.16,
  dashSpeed: 25,
  maxPlayers: 24,
  maxArrows: 360,
  maxOrbs: 140,
});
export const UPGRADES = Object.freeze({
  multishot: {
    name: "Çatal atış",
    icon: "⋔",
    description: "Üç ok atarsın. Yan oklar %30 hasar verir.",
    max: 1,
  },
  pierce: {
    name: "Delici ok",
    icon: "↠",
    description: "Bir ek rakibin içinden geçer.",
    max: 2,
  },
  bounce: {
    name: "Sekme",
    icon: "⌁",
    description: "Arena sınırından bir ek kez seker.",
    max: 2,
  },
  ricochet: {
    name: "Zincir ok",
    icon: "↝",
    max: 1,
    description: "Yakın bir rakibe %40 hasarla seker.",
  },
  frost: {
    name: "Buz oku",
    icon: "❄",
    max: 1,
    description: "0,65 sn %18 yavaşlatır. Yenileme: 2,2 sn.",
  },
  blast: {
    name: "Kor patlaması",
    icon: "✹",
    max: 1,
    description: "Yakındaki diğer rakiplere 4 hasar. 1,1 sn.",
  },
  rear: {
    name: "Artçı ok",
    icon: "↔",
    max: 1,
    description: "Arkaya %50 hasarlı ek bir ok atarsın.",
  },
  longshot: {
    name: "Uzak avcı",
    icon: "◎",
    max: 1,
    description: "12 birim uçan oka %20 ek hasar.",
  },
  poison: {
    name: "Zehir",
    icon: "✧",
    description: "3 sn zehir. Kademe başına +3 toplam hasar.",
    max: 3,
  },
  speed: {
    name: "Rüzgâr adımı",
    icon: "»",
    description: "%8 daha hızlı hareket.",
    max: 3,
  },
  draw: {
    name: "Çevik yay",
    icon: "ϟ",
    description: "%12 hızlı germe ve otomatik atış.",
    max: 3,
  },
  vitality: {
    name: "Orman kalbi",
    icon: "♡",
    description: "+20 azami can; 25 can yenile.",
    max: 3,
  },
});
export const SKINS = Object.freeze(skins);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function cleanInput(data = {}) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  let x = clamp(num(data.x), -1, 1),
    z = clamp(num(data.z), -1, 1),
    l = Math.hypot(x, z);
  if (l > 1) {
    x /= l;
    z /= l;
  }
  return {
    x,
    z,
    angle: num(data.angle) % (Math.PI * 2),
    charge: data.charge === true,
    dash: data.dash === true,
    heal: data.heal === true,
    quickShot: data.quickShot === true,
    cancelShot: data.cancelShot === true,
    seq: clamp(Math.floor(num(data.seq)), 0, 2147483647),
  };
}
export function moveBody(p, input, dt, obstacles) {
  const speed =
    p.dashTime > 0
      ? RULES.dashSpeed
      : RULES.speed *
        (1 + RULES.speedPerUpgrade * (p.upgrades?.speed || 0)) *
        (p.slowTime > 0 ? 1 - RULES.frostSlow : 1);
  const move = p.dashTime > 0 ? { x: p.dashX, z: p.dashZ } : input;
  p.x = clamp(
    p.x + move.x * speed * dt,
    -RULES.size / 2 + RULES.radius,
    RULES.size / 2 - RULES.radius,
  );
  p.z = clamp(
    p.z + move.z * speed * dt,
    -RULES.size / 2 + RULES.radius,
    RULES.size / 2 - RULES.radius,
  );
  for (const o of obstacles) {
    if (o.type === "bush") continue;
    const dx = p.x - o.x,
      dz = p.z - o.z,
      d = Math.hypot(dx, dz),
      r = o.r + RULES.radius;
    if (d < r) {
      p.x = o.x + (d ? dx / d : 1) * r;
      p.z = o.z + (d ? dz / d : 0) * r;
    }
  }
  p.x = clamp(
    p.x,
    -RULES.size / 2 + RULES.radius,
    RULES.size / 2 - RULES.radius,
  );
  p.z = clamp(
    p.z,
    -RULES.size / 2 + RULES.radius,
    RULES.size / 2 - RULES.radius,
  );
}

/** One movement tick shared by server authority, prediction, and input replay. */
export function advanceMovement(p, input, dt, obstacles) {
  p.levelGuard = Math.max(0, (p.levelGuard || 0) - dt);
  p.slowTime = Math.max(0, (p.slowTime || 0) - dt);
  p.slowImmunity = Math.max(0, (p.slowImmunity || 0) - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.dashTime = Math.max(0, p.dashTime - dt);
  if (p.levelGuard > 0) {
    p.dashTime = 0;
    return false;
  }
  p.angle = input.angle;
  const started = input.dash && p.dashCd === 0;
  if (started) {
    const length = Math.hypot(input.x, input.z);
    p.dashCd = RULES.dashCooldown;
    p.dashTime = RULES.dashDuration;
    p.dashX = length ? input.x / length : Math.cos(input.angle);
    p.dashZ = length ? input.z / length : Math.sin(input.angle);
  }
  moveBody(p, input, dt, obstacles);
  return started;
}
