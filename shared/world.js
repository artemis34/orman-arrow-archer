import { applyArrowImpact, redirectRicochet } from "./skills.js";
import { PowerupSystem, attackRate, arrowPower } from "./powerups.js";
import { selectTarget, aimedAngle } from "./aim.js";
import { FreeForAll } from "./modes.js";
import {
  RULES,
  UPGRADES,
  cleanInput,
  clamp,
  moveBody,
  advanceMovement,
} from "./config.js";
import { SpatialGrid, segmentFraction, Pool } from "./spatial.js";
const names = [
  "Juniper",
  "Kestrel",
  "Moss",
  "Willow",
  "Ash",
  "Clover",
  "Rowan",
  "Sage",
];
export class World {
  constructor({ bots = 7, seed = 7821, mode = new FreeForAll() } = {}) {
    this.mode = mode;
    this.seed = seed;
    this.time = 0;
    this.players = new Map();
    this.events = [];
    this.nextId = 0;
    this.grid = new SpatialGrid();
    this.obstacleGrid = new SpatialGrid();
    this.orbGrid = new SpatialGrid();
    this.arrows = new Pool(() => ({ hits: new Set() }), RULES.maxArrows);
    this.orbs = new Pool(() => ({}), RULES.maxOrbs);
    this.obstacles = [];
    for (let i = 0; i < 110; i++) {
      const o = {
        id: i,
        x: (this.random() - 0.5) * 74,
        z: (this.random() - 0.5) * 74,
        r: 0.8 + this.random() * 0.8,
        type: [
          "tree",
          "bush",
          "tree",
          "rock",
          "stump",
          "tree",
          "ruin",
          "bush",
          "log",
        ][i % 9],
      };
      if (
        Math.hypot(o.x, o.z) < 7.5 ||
        this.obstacles.some(
          (p) => Math.hypot(p.x - o.x, p.z - o.z) < p.r + o.r + 1.7,
        )
      )
        continue;
      this.obstacles.push(o);
      this.obstacleGrid.insert(o, o.r);
    }
    this.powerups = new PowerupSystem(this.obstacles);
    for (let i = 0; i < RULES.maxOrbs; i++) this.spawnOrb();
    for (let i = 0; i < bots; i++)
      this.addPlayer(`bot-${i}`, names[i % names.length], i % 4, true);
  }
  random() {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  spawnPoint(clearance = 5) {
    let best = { x: 0, z: 0 },
      bestDistance = -1;
    for (let i = 0; i < 100; i++) {
      const p = {
        x: (this.random() - 0.5) * 72,
        z: (this.random() - 0.5) * 72,
      };
      if (
        this.obstacles.some(
          (o) =>
            o.type !== "bush" && Math.hypot(o.x - p.x, o.z - p.z) < o.r + 2,
        )
      )
        continue;
      const distance = Math.min(
        Infinity,
        ...[...this.players.values()]
          .filter((o) => o.alive)
          .map((o) => Math.hypot(o.x - p.x, o.z - p.z)),
      );
      if (distance > bestDistance) {
        best = p;
        bestDistance = distance;
      }
      if (distance >= clearance) return p;
    }
    return best;
  }

  spawnOrb(x, z, value) {
    const rare =
      value === undefined
        ? this.random() < RULES.rareOrbChance &&
          this.orbs.active.filter((o) => o.rare).length < RULES.maxRareOrbs
        : value >= RULES.rareOrbXP;
    value ??= rare ? RULES.rareOrbXP : RULES.orbXP;
    const o = this.orbs.acquire();
    if (!o) return;
    Object.assign(o, {
      id: ++this.nextId,
      ...(x === undefined ? this.spawnPoint() : { x, z }),
      value,
      rare,
      collected: false,
    });
    return o;
  }
  addPlayer(id, name = "Gezgin", skin = 0, bot = false) {
    if (this.players.size >= RULES.maxPlayers) return null;
    const p = {
      id,
      name:
        (typeof name === "string" ? name : "Gezgin")
          .replace(/[<>\x00-\x1f]/g, "")
          .trim()
          .slice(0, 16) || "Gezgin",
      skin: clamp(Math.floor(Number.isFinite(skin) ? skin : 0), 0, 3),
      bot,
      ...this.spawnPoint(bot ? 5 : 10),
      angle: 0,
      hp: bot ? RULES.botHealth : RULES.playerHealth,
      maxHp: bot ? RULES.botHealth : RULES.playerHealth,
      level: 1,
      xp: 0,
      kills: 0,
      score: 0,
      alive: true,
      charge: 0,
      dashCd: 0,
      healCd: 0,
      dashTime: 0,
      dashX: 0,
      dashZ: 0,
      upgrades: {},
      choices: [],
      pending: 0,
      input: cleanInput(),
      seq: 0,
      poison: 0,
      poisonDps: 0,
      levelGuard: 0,
      buffType: null,
      buffTime: 0,
      autoTargetId: null,
      slowTime: 0,
      slowImmunity: 0,
      blastCd: 0,
      poisonOwner: null,
      spawnShield: bot ? 2 : RULES.playerShield,
      revealUntil: 0,
      vx: 0,
      vz: 0,
      respawnAt: 0,
      shotCd: 0,
      brain: "gather",
      thinkAt: 0,
    };
    this.players.set(id, p);
    return p;
  }
  removePlayer(id) {
    this.players.delete(id);
  }
  setInput(id, data) {
    const p = this.players.get(id);
    if (p && !p.bot) {
      const next = cleanInput(data);
      // Edge-triggered actions must survive batched packets until the next tick.
      next.dash ||= p.input.dash;
      next.heal ||= p.input.heal;
      next.quickShot ||= p.input.quickShot;
      p.input = next;
    }
  }
  choose(id, key) {
    const p = this.players.get(id);
    if (!p?.alive || !p.choices.includes(key)) return false;
    p.upgrades[key] = (p.upgrades[key] || 0) + 1;
    if (key === "vitality") {
      p.maxHp += 20;
      p.hp = Math.min(p.maxHp, p.hp + 25);
    }
    p.pending--;
    this.offer(p);
    if (!p.pending) p.levelGuard = 0;
    return true;
  }
  offer(p) {
    p.choices =
      p.pending > 0
        ? Object.keys(UPGRADES)
            .filter((k) => (p.upgrades[k] || 0) < UPGRADES[k].max)
            .map((k) => ({ k, r: this.random() }))
            .sort((a, b) => a.r - b.r)
            .slice(0, 3)
            .map((a) => a.k)
        : [];
    if (!p.choices.length) p.pending = 0;
  }
  gain(p, amount) {
    const wasPending = p.pending > 0;
    p.xp += amount;
    p.score += amount;
    while (p.xp >= p.level * 55) {
      p.xp -= p.level * 55;
      p.level++;
      p.pending++;
      if (p.alive) p.hp = Math.min(p.maxHp, p.hp + 18);
    }
    if (p.pending && !p.choices.length) this.offer(p);
    if (!wasPending && p.pending && p.alive && !p.bot && p.levelGuard <= 0) {
      p.levelGuard = RULES.levelGuardDuration;
      p.hidden = false;
      p.revealUntil = this.time + RULES.levelGuardDuration;
      p.charge = p.dashTime = p.vx = p.vz = 0;
      p.input.charge = p.input.dash = p.input.heal = p.input.quickShot = false;
      // Cancel without releasing during a swept-hit iteration over this pool.
      for (const arrow of this.arrows.active)
        if (arrow.owner === p.id) arrow.cancelled = true;
      for (const target of this.players.values())
        if (target.poisonOwner === p.id) {
          target.poison = target.poisonDps = 0;
          target.poisonOwner = null;
        }
    }
  }
  damage(p, amount, owner, kind = "impact") {
    if (!p.alive || p.spawnShield > 0 || p.levelGuard > 0) return 0;
    const source = this.players.get(owner);
    if (source && (!this.mode.canDamage(source, p) || source.levelGuard > 0))
      return 0;
    const dealt = Math.min(p.hp, amount);
    p.hp -= amount;
    this.events.push({
      type: "hit",
      kind,
      x: p.x,
      z: p.z,
      target: p.id,
      owner,
      amount: Math.round(amount),
    });
    const attacker = this.players.get(owner);
    if (attacker && attacker !== p && attacker.alive) {
      attacker.damageXpCarry = (attacker.damageXpCarry || 0) + dealt / 3;
      const earned = Math.floor(attacker.damageXpCarry + 1e-8);
      if (earned > 0) {
        attacker.damageXpCarry -= earned;
        this.gain(attacker, earned);
      }
    }
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.buffType = null;
      p.buffTime = 0;
      p.charge = 0;
      p.respawnAt = this.time + 3;
      if (attacker && attacker !== p) {
        attacker.kills++;
        this.gain(attacker, 65);
      }
      this.mode.onElimination(this, attacker, p);
      this.events.push({
        type: "kill",
        name: p.name,
        killer: attacker?.name || "Orman",
        target: p.id,
      });
      for (let i = 0; i < 5; i++)
        this.spawnOrb(
          p.x + (this.random() - 0.5) * 3,
          p.z + (this.random() - 0.5) * 3,
          18,
        );
    }
    return dealt;
  }
  respawn(id) {
    const p = this.players.get(id);
    if (!p || p.alive || this.time < p.respawnAt) return false;
    Object.assign(p, this.spawnPoint(p.bot ? 5 : 10), {
      hp: p.bot ? RULES.botHealth : RULES.playerHealth,
      maxHp: p.bot ? RULES.botHealth : RULES.playerHealth,
      level: 1,
      xp: 0,
      damageXpCarry: 0,
      upgrades: {},
      choices: [],
      pending: 0,
      alive: true,
      charge: 0,
      dashCd: 0,
      healCd: 0,
      dashTime: 0,
      poison: 0,
      poisonDps: 0,
      levelGuard: 0,
      buffType: null,
      buffTime: 0,
      autoTargetId: null,
      slowTime: 0,
      slowImmunity: 0,
      blastCd: 0,
      shotCd: 0,
      spawnShield: p.bot ? 2 : RULES.playerShield,
      revealUntil: 0,
      vx: 0,
      vz: 0,
      input: cleanInput(),
    });
    return true;
  }
  fire(p, quick = false) {
    if (p.charge < 0.08 || p.shotCd > 0 || !p.alive || p.levelGuard > 0)
      return false;
    let fired = false;
    const q = clamp(p.charge, 0, 1),
      spread = p.upgrades.multishot ? [-0.16, 0, 0.16] : [0];
    if (p.upgrades.rear) spread.push(Math.PI);
    for (const offset of spread) {
      const a = this.arrows.acquire();
      if (!a) break;
      fired = true;
      const primary = offset === 0,
        rear = offset === Math.PI;
      const angle = p.angle + offset,
        speed = 19 + q * 23;
      a.hits.clear();
      Object.assign(a, {
        cancelled: false,
        distance: 0,
        ricochet: primary ? p.upgrades.ricochet || 0 : 0,
        frost: primary && !!p.upgrades.frost,
        blast: primary && !!p.upgrades.blast,
        longshot: primary && !!p.upgrades.longshot,
        effect:
          primary && p.upgrades.frost
            ? "frost"
            : primary && p.upgrades.blast
              ? "blast"
              : p.upgrades.poison && !rear
                ? "poison"
                : "normal",
        id: ++this.nextId,
        owner: p.id,
        x: p.x + Math.cos(angle) * 0.9,
        z: p.z + Math.sin(angle) * 0.9,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        life: 0.5 + q * 0.9,
        damage:
          RULES.arrowDamage *
          (rear ? RULES.rearArrowScale : offset ? RULES.sideArrowScale : 1) *
          arrowPower(p) *
          (p.bot ? RULES.botDamageScale : 1),
        poisonDps:
          (p.upgrades.poison || 0) *
          RULES.poisonDps *
          (primary ? 1 : rear ? 0 : RULES.sideArrowScale) *
          (p.bot ? RULES.botDamageScale : 1),
        pierce: p.upgrades.pierce || 0,
        bounce: p.upgrades.bounce || 0,
        poison: rear ? 0 : p.upgrades.poison || 0,
      });
    }
    if (!fired) return false;
    p.spawnShield = 0;
    p.revealUntil = this.time + 0.6;
    p.shotCd =
      (RULES.shotCooldown * Math.pow(RULES.drawFactor, p.upgrades.draw || 0)) /
      attackRate(p);
    this.events.push({ type: "shot", x: p.x, z: p.z, owner: p.id, quick });
    return true;
  }
  autoTarget(p) {
    const target =
      p.alive && p.levelGuard <= 0
        ? selectTarget(
            p,
            [...this.players.values()].filter((q) => this.mode.canDamage(p, q)),
            this.obstacles,
          )
        : null;
    p.autoTargetId = target?.id || null;
    return target;
  }
  quickShot(p) {
    if (!p.alive || p.shotCd > 0 || p.levelGuard > 0) return false;
    const target = this.autoTarget(p);
    if (!target) return false;
    p.angle = aimedAngle(
      p,
      target,
      19 + RULES.quickShotCharge * 23,
      this.obstacles,
    );
    p.charge = RULES.quickShotCharge;
    const fired = this.fire(p, true);
    p.charge = 0;
    if (fired)
      p.shotCd =
        (RULES.quickShotCooldown *
          Math.pow(RULES.drawFactor, p.upgrades.draw || 0)) /
        attackRate(p);
    return fired;
  }
  botInput(p, dt) {
    if (p.choices.length)
      this.choose(
        p.id,
        p.choices[Math.floor(this.random() * p.choices.length)],
      );
    if (this.time >= p.thinkAt) {
      p.thinkAt = this.time + 0.25;
      const target = [...this.players.values()]
        .filter(
          (o) =>
            o !== p &&
            o.alive &&
            o.spawnShield <= 0 &&
            o.levelGuard <= 0 &&
            (!o.hidden || Math.hypot(o.x - p.x, o.z - p.z) < 5),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
        )[0];
      let goal,
        charge = false;
      p.brain =
        target && Math.hypot(target.x - p.x, target.z - p.z) < 19
          ? "fight"
          : "gather";
      if (p.brain === "fight") {
        const dist = Math.hypot(target.x - p.x, target.z - p.z);
        goal =
          dist < 8
            ? { x: p.x - (target.x - p.x), z: p.z - (target.z - p.z) }
            : target;
        p.angle =
          Math.atan2(target.z - p.z, target.x - p.x) +
          (this.random() - 0.5) * 0.12;
        charge = p.charge < 0.85;
      } else {
        goal = this.orbs.active.reduce(
          (best, o) =>
            !best ||
            Math.hypot(o.x - p.x, o.z - p.z) / (o.rare ? 3 : 1) <
              Math.hypot(best.x - p.x, best.z - p.z) / (best.rare ? 3 : 1)
              ? o
              : best,
          null,
        );
        const buff = this.powerups.goal(p);
        if (
          buff &&
          (!goal ||
            Math.hypot(buff.x - p.x, buff.z - p.z) / 4 <
              Math.hypot(goal.x - p.x, goal.z - p.z) / (goal.rare ? 3 : 1))
        )
          goal = buff;
      }
      if (!goal) goal = { x: 0, z: 0 };
      let dx = goal.x - p.x,
        dz = goal.z - p.z,
        l = Math.hypot(dx, dz) || 1;
      const nearby = [...this.obstacleGrid.query(p.x, p.z, 3)].filter(
        (o) => o.type !== "bush",
      );
      for (const o of nearby) {
        const ox = p.x - o.x,
          oz = p.z - o.z,
          d = Math.hypot(ox, oz);
        if (d < o.r + 2) {
          dx = dx / l + (ox / (d || 1)) * 3;
          dz = dz / l + (oz / (d || 1)) * 3;
          l = Math.hypot(dx, dz) || 1;
        }
      }
      p.input = cleanInput({
        x: dx / l,
        z: dz / l,
        angle: p.angle,
        charge,
        heal: p.hp < 60,
        dash: p.hp < 40 && this.random() < 0.15,
      });
    }
  }
  step(dt = 1 / RULES.tick) {
    dt = clamp(dt, 0, 0.05);
    this.time += dt;
    this.events = [];
    this.powerups.tick(dt, this.players.values());
    this.mode.step(this, dt);
    this.grid.clear();
    this.orbGrid.clear();
    for (const o of this.orbs.active) this.orbGrid.insert(o);
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.bot) this.respawn(p.id);
        continue;
      }
      const oldX = p.x,
        oldZ = p.z;
      if (p.bot) this.botInput(p, dt);
      p.shotCd = Math.max(0, p.shotCd - dt);
      p.spawnShield = Math.max(0, p.spawnShield - dt);
      p.healCd = Math.max(0, p.healCd - dt);
      const i = p.input;
      p.seq = i.seq;
      if (advanceMovement(p, i, dt, [...this.obstacleGrid.query(p.x, p.z, 4)]))
        this.events.push({ type: "dash", x: p.x, z: p.z, owner: p.id });
      p.blastCd = Math.max(0, p.blastCd - dt);
      if (i.heal && p.levelGuard <= 0 && p.healCd === 0 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + 25);
        p.healCd = 14;
        this.events.push({ type: "heal", x: p.x, z: p.z, owner: p.id });
      }
      p.input.heal = false;
      p.input.dash = false;
      if (!p.bot) this.autoTarget(p);
      const quick = i.quickShot && !i.charge && p.levelGuard <= 0;
      p.input.quickShot = false;
      if (quick) {
        this.quickShot(p);
        // A short stick tap may have started drawing on pointerdown. It is an
        // auto-shot gesture, so a missing target must not release that partial draw.
        p.charge = 0;
      }
      if (p.levelGuard > 0) p.charge = 0;
      else if (i.charge) {
        p.charge = clamp(
          p.charge +
            dt /
              ((RULES.drawTime *
                Math.pow(RULES.drawFactor, p.upgrades.draw || 0)) /
                attackRate(p)),
          0,
          1,
        );
        p.hidden = false;
      } else if (p.charge) {
        this.fire(p);
        p.charge = 0;
      }
      p.hidden =
        !i.charge &&
        this.time >= (p.revealUntil || 0) &&
        this.obstacles.some(
          (o) => o.type === "bush" && Math.hypot(o.x - p.x, o.z - p.z) < o.r,
        );
      if (p.poison > 0) {
        p.poison -= dt;
        this.damage(
          p,
          dt * (p.poisonDps || RULES.poisonDps),
          p.poisonOwner,
          "poison",
        );
      } else if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + dt * 0.8);
      if (!p.alive) continue;
      if (p.dashTime <= 0 && p.levelGuard <= 0)
        for (const q of this.grid.query(p.x, p.z, RULES.radius * 2)) {
          if (!q.alive || q.dashTime > 0 || q.levelGuard > 0) continue;
          const dx = p.x - q.x,
            dz = p.z - q.z,
            d = Math.hypot(dx, dz),
            overlap = RULES.radius * 2 - d;
          if (overlap > 0) {
            const nx = d ? dx / d : 1,
              nz = d ? dz / d : 0;
            p.x += nx * overlap * 0.5;
            p.z += nz * overlap * 0.5;
            q.x -= nx * overlap * 0.5;
            q.z -= nz * overlap * 0.5;
            moveBody(q, { x: 0, z: 0 }, 0, [
              ...this.obstacleGrid.query(q.x, q.z, 3),
            ]);
          }
        }
      moveBody(p, { x: 0, z: 0 }, 0, [...this.obstacleGrid.query(p.x, p.z, 3)]);
      p.vx = dt ? (p.x - oldX) / dt : 0;
      p.vz = dt ? (p.z - oldZ) / dt : 0;
      this.grid.insert(p, RULES.radius);
      for (const o of this.orbGrid.query(p.x, p.z, 1.5)) {
        if (
          p.levelGuard > 0 ||
          o.collected ||
          Math.hypot(o.x - p.x, o.z - p.z) > 1.3
        )
          continue;
        o.collected = true;
        this.gain(p, o.value);
        this.events.push({
          type: "gem",
          x: o.x,
          z: o.z,
          owner: p.id,
          rare: o.rare,
          value: o.value,
        });
      }
      this.powerups.collect(p, this.events);
    }
    for (let n = this.orbs.active.length - 1; n >= 0; n--)
      if (this.orbs.active[n].collected) {
        this.orbs.active[n].collected = false;
        this.orbs.release(n);
      }
    for (let n = this.arrows.active.length - 1; n >= 0; n--) {
      const a = this.arrows.active[n],
        ox = a.x,
        oz = a.z;
      if (a.cancelled || this.players.get(a.owner)?.levelGuard > 0) {
        this.arrows.release(n);
        continue;
      }
      const priorDistance = a.distance;
      a.x += a.vx * dt;
      a.z += a.vz * dt;
      a.life -= dt;
      a.distance += Math.hypot(a.x - ox, a.z - oz);
      let dead = a.life <= 0;
      if (Math.abs(a.x) > RULES.size / 2 || Math.abs(a.z) > RULES.size / 2) {
        if (a.bounce > 0) {
          if (Math.abs(a.x) > RULES.size / 2) a.vx *= -1;
          if (Math.abs(a.z) > RULES.size / 2) a.vz *= -1;
          a.x = clamp(a.x, -RULES.size / 2, RULES.size / 2);
          a.z = clamp(a.z, -RULES.size / 2, RULES.size / 2);
          a.bounce--;
        } else dead = true;
      }
      // Resolve swept contacts in travel order, so cover behind a target cannot absorb its hit.
      const contacts = [],
        mx = (ox + a.x) / 2,
        mz = (oz + a.z) / 2,
        range = Math.hypot(a.x - ox, a.z - oz) / 2;
      if (!dead) {
        for (const o of this.obstacleGrid.query(mx, mz, range + 2)) {
          if (o.type === "bush") continue;
          const t = segmentFraction(ox, oz, a.x, a.z, o.x, o.z, o.r);
          if (t !== null) contacts.push({ t, terrain: true });
        }
        for (const p of this.grid.query(mx, mz, range + 1)) {
          if (
            !p.alive ||
            p.id === a.owner ||
            (this.players.has(a.owner) &&
              !this.mode.canDamage(this.players.get(a.owner), p)) ||
            a.hits.has(p.id) ||
            p.dashTime > 0 ||
            p.levelGuard > 0
          )
            continue;
          const t = segmentFraction(
            ox,
            oz,
            a.x,
            a.z,
            p.x,
            p.z,
            RULES.radius + 0.13,
          );
          if (t !== null) contacts.push({ t, p });
        }
        contacts.sort((a, b) => a.t - b.t);
        for (const hit of contacts) {
          if (hit.terrain) {
            dead = true;
            break;
          }
          const p = hit.p;
          a.hits.add(p.id);
          const hitDistance =
            priorDistance + Math.hypot(a.x - ox, a.z - oz) * hit.t;
          const struck = applyArrowImpact(this, a, p, hitDistance);
          if (a.cancelled) {
            dead = true;
            break;
          }
          if (struck && redirectRicochet(this, a, p)) break;
          if (a.pierce > 0) a.pierce--;
          else {
            dead = true;
            break;
          }
        }
      }
      if (dead) this.arrows.release(n);
    }
    if (this.orbs.active.length < RULES.maxOrbs && this.random() < dt * 12)
      this.spawnOrb();
  }
  snapshot(viewerId) {
    const viewer = this.players.get(viewerId);
    const visible = (p) =>
      !p.hidden ||
      p.id === viewerId ||
      (viewer && Math.hypot(p.x - viewer.x, p.z - viewer.z) < 5);
    return {
      time: this.time,
      players: [...this.players.values()].filter(visible).map((p) => ({
        id: p.id,
        name: p.name,
        skin: p.skin,
        x: p.x,
        z: p.z,
        vx: p.vx,
        vz: p.vz,
        angle: p.angle,
        hp: p.hp,
        maxHp: p.maxHp,
        level: p.level,
        xp: p.xp,
        kills: p.kills,
        score: p.score,
        alive: p.alive,
        charge: p.charge,
        levelGuard: p.levelGuard,
        buffType: p.buffType,
        buffTime: p.buffTime,
        autoTargetId: p.id === viewerId ? p.autoTargetId : null,
        slowTime: p.slowTime,
        slowImmunity: p.slowImmunity,
        shotCd: p.shotCd,
        dashCd: p.dashCd,
        healCd: p.healCd,
        dashTime: p.dashTime,
        dashX: p.dashX,
        dashZ: p.dashZ,
        upgrades: p.upgrades,
        choices: p.id === viewerId ? p.choices : [],
        pending: p.id === viewerId ? p.pending : 0,
        hidden: p.hidden,
        spawnShield: p.spawnShield,
        seq: p.seq,
        respawnIn: Math.max(0, p.respawnAt - this.time),
        bot: p.bot,
      })),
      arrows: this.arrows.active.map((a) => ({
        id: a.id,
        x: a.x,
        z: a.z,
        angle: Math.atan2(a.vz, a.vx),
        poison: a.poison,
        effect: a.effect,
      })),
      orbs: this.orbs.active.map((o) => ({
        id: o.id,
        x: o.x,
        z: o.z,
        value: o.value,
        rare: o.rare,
      })),
      powerups: this.powerups.snapshot(),
      events: this.events.filter((e) => {
        if (e.type === "kill") return true; // Kill feed has names, no coordinates.
        const subject = this.players.get(e.target || e.owner);
        return !subject || visible(subject);
      }),
    };
  }
}
