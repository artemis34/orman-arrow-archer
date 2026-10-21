import { forestMaterials, forestProp, decorateForest } from "./forest.js";
import { createPose, updatePose } from "./presentation.js";
import { AvatarBatches, ArrowBatches, ParticleBatch } from "./render-pools.js";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RULES, SKINS } from "../shared/config.js";
import { POWERUPS, POWERUP_RULES } from "../shared/powerups.js";
import { TEAMS } from "../shared/modes.js";
import { CATALOG } from "../shared/profile.js";
import { REGIONS } from "../shared/regions.js";
import { CombatFeedback } from "./combat-feedback.js";
import { LootView } from "./loot-view.js";
import { BowBuffEffects } from "./bow-buff-effects.js";
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const COSMETICS = new Map(CATALOG.map((item) => [item.id, item]));
const COSMETIC_SLOTS = [...new Set(CATALOG.map((item) => item.slot))];
function sameCosmetics(saved, next) {
  for (const slot of COSMETIC_SLOTS)
    if (saved[slot] !== next?.[slot]) return false;
  return true;
}
/** All dynamic meshes are created once and reused across snapshots. */
export class ArenaScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: devicePixelRatio < 2,
      powerPreference: "high-performance",
    });
    const touchDevice = matchMedia("(pointer: coarse)").matches;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, touchDevice ? 1.5 : 1.8),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x547d5a);
    this.scene = new THREE.Scene();
    // This scene stays at the origin. Update its children once before uploading
    // instance transforms instead of repeating that traversal inside render().
    this.scene.matrixAutoUpdate = false;
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.fog = new THREE.FogExp2(0x607f60, 0.008);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
    this.camera.position.set(0, 34, 28);
    this.camera.lookAt(0, 0, 0);
    this.target = new THREE.Vector3();
    this.players = new Map();
    this.orbMeshes = [];
    this.effects = [];
    this.ray = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(Y_AXIS, 0);
    this.pointer = new THREE.Vector2();
    this.intersection = new THREE.Vector3();
    this.screenOrigin = new THREE.Vector3();
    this.worldGroup = new THREE.Group();
    this.staticGroup = new THREE.Group();
    this.scene.add(this.worldGroup, this.staticGroup);
    this.time = 0;
    this.built = false;
    const hemi = new THREE.HemisphereLight(0xe0f2cc, 0x41563a, 2.3);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffedc4, 3.2);
    sun.position.set(-22, 45, 18);
    sun.castShadow = true;
    const shadowSize = touchDevice ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -52;
    sun.shadow.camera.right = 52;
    sun.shadow.camera.top = 52;
    sun.shadow.camera.bottom = -52;
    sun.shadow.camera.far = 100;
    sun.shadow.normalBias = 0.07;
    this.scene.add(sun);
    this.sun = sun;
    this.materials = {
      ground: new THREE.MeshStandardMaterial({ color: 0x799567, roughness: 1 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x69513c, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x397148, roughness: 1 }),
      leaf2: new THREE.MeshStandardMaterial({ color: 0x54834e, roughness: 1 }),
      leaf3: new THREE.MeshStandardMaterial({ color: 0x638b50, roughness: 1 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x96a28c, roughness: 1 }),
      bush: new THREE.MeshStandardMaterial({ color: 0x759a50, roughness: 1 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xecd68d, roughness: 0.6 }),
      gem: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x5a7c28,
        emissiveIntensity: 0.4,
        roughness: 0.35,
        metalness: 0.15,
      }),
    };
    this.forestMats = forestMaterials();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      this.materials.ground,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const rand = (() => {
      let s = 123;
      return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
    })();
    const patchMaterials = [0x7e9c67, 0x6a8d5a].map(
      (color) =>
        new THREE.MeshStandardMaterial({
          color,
          roughness: 1,
          depthWrite: false,
        }),
    );
    const patches = [[], []];
    for (let i = 0; i < 210; i++) {
      const geometry = new THREE.CircleGeometry(1 + rand() * 3, 7);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate((rand() - 0.5) * 100, 0.015, (rand() - 0.5) * 100);
      patches[i % 2].push(geometry);
    }
    for (let i = 0; i < patches.length; i++) {
      this.staticGroup.add(
        new THREE.Mesh(mergeGeometries(patches[i]), patchMaterials[i]),
      );
      for (const geometry of patches[i]) geometry.dispose();
    }
    const borderMat = new THREE.MeshBasicMaterial({
      color: 0xf0aa77,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (const [x, z, rot] of [
      [0, -42, 0],
      [0, 42, 0],
      [-42, 0, Math.PI / 2],
      [42, 0, Math.PI / 2],
    ]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(84, 1.8), borderMat);
      wall.position.set(x, 0.9, z);
      wall.rotation.y = rot;
      this.scene.add(wall);
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(84, 0.07, 0.09),
        new THREE.MeshBasicMaterial({ color: 0xf5bc83 }),
      );
      line.position.set(x, 0.08, z);
      line.rotation.y = rot;
      this.scene.add(line);
    }
    // Distant forest frames the playable arena without adding collision cost.
    for (let i = 0; i < 85; i++) {
      const a = (i / 85) * Math.PI * 2,
        r = 53 + rand() * 10;
      const t = this.tree(1.3 + rand() * 0.6);
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.staticGroup.add(t);
    }
    this.batch(this.staticGroup);
    this.avatarBatches = new AvatarBatches(this.scene);
    this.arrows = new ArrowBatches(this.scene, RULES.maxArrows);
    this.feedback = new CombatFeedback(this.scene);
    this.lootView = new LootView(this.scene);
    this.bowBuffs = new BowBuffEffects(this.scene);
    this.gems = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.24),
      this.materials.gem,
      RULES.maxOrbs,
    );
    this.gems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gems.frustumCulled = false;
    this.scene.add(this.gems);
    this.gemDummy = new THREE.Object3D();
    this.gemColors = {
      normal: new THREE.Color(0xcaed8b),
      rare: new THREE.Color(0xffcd70),
    };
    this.rareHalos = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.7, 0.88, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd47d,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      RULES.maxRareOrbs,
    );
    this.rareHalos.frustumCulled = false;
    this.rareHalos.count = 0;
    this.scene.add(this.rareHalos);
    this.powerupMeshes = [];
    for (let i = 0; i < POWERUP_RULES.count; i++) {
      const group = new THREE.Group();
      const pad = new THREE.Mesh(
        new THREE.RingGeometry(0.45, 0.95, 6),
        new THREE.MeshBasicMaterial({
          color: 0x71877b,
          side: THREE.DoubleSide,
        }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.04;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1.04, 32),
        new THREE.MeshBasicMaterial({
          color: 0x82dfff,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      const emblem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.48, 0),
        new THREE.MeshStandardMaterial({
          color: 0x82dfff,
          emissive: 0x82dfff,
          emissiveIntensity: 0.55,
          roughness: 0.4,
        }),
      );
      group.add(pad, ring, emblem);
      group.visible = false;
      this.scene.add(group);
      this.powerupMeshes.push({ group, ring, emblem });
    }
    this.haloDummy = new THREE.Object3D();
    this.haloDummy.rotation.x = -Math.PI / 2;
    const effectGeo = new THREE.OctahedronGeometry(0.11);
    for (let i = 0; i < 140; i++) {
      const mesh = new THREE.Mesh(
        effectGeo,
        new THREE.MeshBasicMaterial({ color: 0xd8f5a3, transparent: true }),
      );
      mesh.visible = false;
      this.effects.push({ mesh, life: 0, vx: 0, vz: 0, vy: 0 });
    }
    this.particles = new ParticleBatch(this.scene, this.effects, effectGeo);
    this.lockRing = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 0.93, 36),
      new THREE.MeshBasicMaterial({
        color: 0xf2d28c,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.lockRing.rotation.x = -Math.PI / 2;
    this.lockRing.visible = false;
    this.scene.add(this.lockRing);
    this.reticle = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.38, 32),
      new THREE.MeshBasicMaterial({
        color: 0xf0f5cf,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.reticle.add(ring);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.02, 0.04),
        ring.material,
      );
      tick.position.set(
        Math.cos((i * Math.PI) / 2) * 0.55,
        0,
        Math.sin((i * Math.PI) / 2) * 0.55,
      );
      tick.rotation.y = (-i * Math.PI) / 2;
      this.reticle.add(tick);
    }
    this.scene.add(this.reticle);
    this.reticle.visible = false;
    this.aimLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]),
      new THREE.LineDashedMaterial({
        color: 0xe5f5b2,
        dashSize: 0.3,
        gapSize: 0.25,
        transparent: true,
        opacity: 0.4,
      }),
    );
    this.scene.add(this.aimLine);
    this.aimLine.geometry.setAttribute(
      "lineDistance",
      new THREE.Float32BufferAttribute([0, 0], 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.aimLine.frustumCulled = false;
    this.aimLine.visible = false;
    this.resize();
    this.shrine = new THREE.Mesh(
      new THREE.RingGeometry(2.9, 3.15, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffd278,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    this.shrine.rotation.x = -Math.PI / 2;
    this.shrine.position.y = 0.065;
    this.shrine.visible = false;
    this.scene.add(this.shrine);
    addEventListener("resize", () => this.resize());
  }
  setQuality(quality) {
    this.quality = quality;
    this.renderer.setPixelRatio(
      Math.min(
        devicePixelRatio,
        quality === "low" ? 1 : quality === "high" ? 2 : 1.5,
      ),
    );
    this.renderer.shadowMap.enabled = quality !== "low";
    this.resize();
  }
  batch(group) {
    group.updateMatrixWorld(true);
    const batches = new Map();
    group.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.uuid + ":" + o.castShadow;
      if (!batches.has(key))
        batches.set(key, {
          material: o.material,
          cast: o.castShadow,
          geometries: [],
        });
      let geometry = o.geometry.clone();
      if (geometry.index) geometry = geometry.toNonIndexed();
      geometry.deleteAttribute("uv");
      geometry.applyMatrix4(o.matrixWorld);
      batches.get(key).geometries.push(geometry);
    });
    const originals = [];
    group.traverse((o) => {
      if (o.isMesh) originals.push(o.geometry);
    });
    group.clear();
    for (const entry of batches.values()) {
      const merged = mergeGeometries(entry.geometries);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, entry.material);
      mesh.castShadow = entry.cast;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of entry.geometries) g.dispose();
    }
    for (const g of new Set(originals)) g.dispose();
    group.traverse((object) => {
      object.updateMatrix();
      object.matrixAutoUpdate = false;
    });
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  tree(scale = 1) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.42, 2.1, 6),
      this.materials.trunk,
    );
    trunk.position.y = 1;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry((1.85 - i * 0.35) * scale, 2.4 * scale, 7),
        [this.materials.leaf, this.materials.leaf2, this.materials.leaf3][i],
      );
      leaves.position.y = (2.2 + i * 1.05) * scale;
      leaves.rotation.y = i * 0.5;
      leaves.castShadow = true;
      g.add(leaves);
    }
    return g;
  }
  setMap(obstacles) {
    const key = JSON.stringify(obstacles);
    if (this.mapKey === key) return;
    this.mapKey = key;
    this.worldGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.worldGroup.clear();
    // Broad, subtle ground patches make navigation recognizable without extra obstacles.
    this.regionMaterials ||= REGIONS.map(
      (region) =>
        new THREE.MeshStandardMaterial({
          color: region.color,
          roughness: 1,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
    );
    for (const [index, region] of REGIONS.entries()) {
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(region.radius, 12),
        this.regionMaterials[index],
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(region.x, 0.021, region.z);
      this.worldGroup.add(patch);
    }
    this.built = true;
    this.obstacles = obstacles;
    for (const o of obstacles)
      this.worldGroup.add(forestProp(o, this.forestMats));
    decorateForest(this.worldGroup, this.forestMats, obstacles);
    this.batch(this.worldGroup);
  }
  disposePlayer(v) {
    const geometries = new Set(),
      materials = new Set();
    this.avatarBatches.remove(v.root);
    v.root.traverse((o) => {
      if (o.geometry && !o.userData.batched) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    v.tex.dispose();
    this.scene.remove(v.root);
  }
  makePlayer(p, local = false) {
    const root = new THREE.Group(),
      body = new THREE.Group(),
      lowerBody = new THREE.Group();
    root.add(body, lowerBody);
    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(0.56, 20),
      new THREE.MeshBasicMaterial({
        color: 0x173025,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.028;
    contact.userData.instanceGround = true;
    root.add(contact);
    const skin = SKINS[p.skin] || SKINS[0],
      cosmetic = (slot) =>
        CATALOG.find((item) => item.id === p.cosmetics?.[slot]),
      cloth = new THREE.MeshStandardMaterial({ color: skin.body }),
      cape = new THREE.MeshStandardMaterial({
        color: cosmetic("cape")?.color || skin.cape,
        side: THREE.DoubleSide,
      }),
      skinMat = new THREE.MeshStandardMaterial({ color: 0xf0d0a1 }),
      dark = new THREE.MeshStandardMaterial({ color: 0x2b3b2c });
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.33, 0.42, 0.72, 7),
      cloth,
    );
    torso.position.y = 0.83;
    torso.castShadow = true;
    body.add(torso);
    const head = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.31, 1),
      skinMat,
    );
    head.position.y = 1.45;
    head.castShadow = true;
    body.add(head);
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 8, 6, Math.PI / 2, Math.PI * 1.5),
      new THREE.MeshStandardMaterial({
        color: cosmetic("hood")?.color || skin.cape,
        side: THREE.DoubleSide,
      }),
    );
    hood.position.set(-0.04, 1.48, 0);
    body.add(hood);
    const capeMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.44, 0.9, 4, 1, true),
      cape,
    );
    capeMesh.position.set(-0.25, 0.85, 0);
    capeMesh.rotation.z = -0.25;
    body.add(capeMesh);
    const legs = [];
    for (const z of [-0.18, 0.18]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.48, 0.22), dark);
      const hip = new THREE.Group();
      hip.position.set(0, 0.48, z);
      leg.position.y = -0.24;
      hip.add(leg);
      lowerBody.add(hip);
      const boot = new THREE.Mesh(
        new THREE.BoxGeometry(0.31, 0.12, 0.24),
        dark,
      );
      boot.position.set(0, -0.42, 0);
      hip.add(boot);
      legs.push(hip);
    }
    const bow = new THREE.Group();
    const curve = new THREE.EllipseCurve(
      0,
      0,
      0.48,
      0.72,
      -Math.PI / 2,
      Math.PI / 2,
      false,
      0,
    );
    const points = curve
      .getPoints(18)
      .map((pt) => new THREE.Vector3(pt.x, 1, pt.y));
    const bowLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: cosmetic("bow")?.color || 0xe7bf79,
      }),
    );
    bow.add(bowLine);
    const string = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 1, -0.72),
        new THREE.Vector3(-0.05, 1, 0),
        new THREE.Vector3(0, 1, 0.72),
      ]),
      new THREE.LineBasicMaterial({ color: 0xf3ecd0 }),
    );
    bow.add(string);
    bow.position.x = 0.45;
    body.add(bow);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.17, 0.18), cloth);
    arm.position.set(0.37, 1, 0.2);
    body.add(arm);
    const base = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.76, 32),
      new THREE.MeshBasicMaterial({
        color: 0xe1f3a8,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.035;
    base.userData.instanceGround = true;
    root.add(base);
    const buffRing = new THREE.Mesh(
      new THREE.RingGeometry(0.84, 0.91, 32),
      new THREE.MeshBasicMaterial({
        color: 0x82dfff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    buffRing.rotation.x = -Math.PI / 2;
    buffRing.position.y = 0.06;
    buffRing.visible = false;
    root.add(buffRing);
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xd5f0b1,
        transparent: true,
        opacity: 0.13,
        wireframe: true,
      }),
    );
    shield.position.y = 0.7;
    root.add(shield);
    // Pooled with the avatar: a golden countdown and rising sparks are visible
    // to every viewer for exactly the authority's remaining guard duration.
    const levelEffect = new THREE.Group();
    const guardRing = new THREE.Mesh(
      new THREE.RingGeometry(1.06, 1.17, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffe49b,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    guardRing.rotation.x = -Math.PI / 2;
    guardRing.rotation.z = Math.PI / 2;
    guardRing.position.y = 0.08;
    levelEffect.add(guardRing);
    const sparkGeometry = new THREE.OctahedronGeometry(0.1),
      sparkMaterial = new THREE.MeshBasicMaterial({
        color: 0xffedb5,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
    const guardSparks = [];
    for (let i = 0; i < 6; i++) {
      const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
      guardSparks.push(spark);
      levelEffect.add(spark);
    }
    levelEffect.visible = false;
    root.add(levelEffect);
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 256;
    labelCanvas.height = 80;
    const ctx = labelCanvas.getContext("2d");
    ctx.textAlign = "center";
    ctx.font = "600 22px sans-serif";
    ctx.fillStyle = "#eef3dc";
    ctx.shadowColor = "#142c20";
    ctx.shadowBlur = 7;
    if (!local) ctx.fillText(p.name, 128, 27);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#192e22";
    ctx.fillRect(64, 44, 128, 8);
    ctx.fillStyle = p.hp < p.maxHp * 0.3 ? "#e6a181" : "#bde08d";
    ctx.fillRect(64, 44, 128 * Math.max(0, p.hp / p.maxHp), 8);
    const tex = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        depthTest: false,
        transparent: true,
      }),
    );
    label.scale.set(3.8, 1.2, 1);
    label.position.y = local ? 2.35 : 2.6;
    root.add(label);
    this.avatarBatches.add(root);
    this.scene.add(root);
    return {
      root,
      body,
      lowerBody,
      cape: capeMesh,
      footstep: 0,
      legs,
      bow,
      arm,
      bowLine,
      buffRing,
      string,
      base,
      shield,
      levelEffect,
      guardRing,
      guardSparks,
      guardActive: false,
      level: p.level,
      label,
      canvas: labelCanvas,
      tex,
      pose: createPose(p),
      hp: p.hp,
      maxHp: p.maxHp,
      skin: p.skin,
      cosmetics: { ...p.cosmetics },
      bowColor: cosmetic("bow")?.color || 0xe7bf79,
      spawnColor: cosmetic("spawn")?.color || 0xbde08d,
      wasAlive: p.alive,
      name: p.name,
    };
  }
  burst(x, z, color, count = 8) {
    let done = 0;
    for (const e of this.effects) {
      if (e.life > 0) continue;
      e.life = 0.4 + Math.random() * 0.25;
      e.mesh.position.set(x, 0.8, z);
      e.mesh.material.color.set(color);
      e.mesh.scale.setScalar(1);
      e.vx = (Math.random() - 0.5) * 5;
      e.vz = (Math.random() - 0.5) * 5;
      e.vy = 2 + Math.random() * 3;
      e.mesh.visible = true;
      if (++done >= count) break;
    }
  }
  stepDust(x, z) {
    const e = this.effects.find((p) => p.life <= 0);
    if (!e) return;
    e.life = 0.2;
    e.mesh.position.set(x, 0.06, z);
    e.mesh.scale.setScalar(0.45);
    e.mesh.material.color.setHex(0xc2bd8b);
    e.mesh.material.opacity = 0.4;
    e.mesh.visible = true;
    e.vx = (Math.random() - 0.5) * 0.6;
    e.vz = (Math.random() - 0.5) * 0.6;
    e.vy = 0.3;
  }
  aimAt(clientX, clientY, p) {
    this.pointer.set(
      (clientX / innerWidth) * 2 - 1,
      (-clientY / innerHeight) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    this.ray.ray.intersectPlane(this.groundPlane, this.intersection);
    return Math.atan2(this.intersection.z - p.z, this.intersection.x - p.x);
  }
  aimFromStick(x, z, p) {
    // Project from the character, not the screen centre. The tilted perspective
    // otherwise makes diagonal walking/aiming disagree with the thumb direction.
    this.screenOrigin.set(p.x, 0, p.z).project(this.camera);
    return this.aimAt(
      ((this.screenOrigin.x + 1) * innerWidth) / 2 + x * 60,
      ((1 - this.screenOrigin.y) * innerHeight) / 2 + z * 60,
      p,
    );
  }
  pickPlayer(x, y, players, myId) {
    const me = players.find((p) => p.id === myId);
    let nearest = null,
      distance = 34;
    for (const p of players) {
      if (
        p.id === myId ||
        (me?.team != null && p.team === me.team) ||
        !p.alive ||
        p.spawnShield > 0 ||
        p.levelGuard > 0
      )
        continue;
      const point = new THREE.Vector3(p.x, 1, p.z).project(this.camera);
      if (point.z < -1 || point.z > 1) continue;
      const d = Math.hypot(
        ((point.x + 1) * innerWidth) / 2 - x,
        ((1 - point.y) * innerHeight) / 2 - y,
      );
      if (d < distance) {
        distance = d;
        nearest = p;
      }
    }
    return nearest;
  }
  networkRadius() {
    let radius = 34;
    this.camera.updateMatrixWorld();
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        this.ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
        if (this.ray.ray.intersectPlane(this.groundPlane, this.intersection))
          radius = Math.max(
            radius,
            Math.hypot(
              this.intersection.x - this.target.x,
              this.intersection.z - this.target.z,
            ) + 4,
          );
      }
    return Math.min(80, Math.ceil(radius));
  }
  render(state, myId, dt, playing, lockId = null) {
    this.time += dt;
    const me = state?.players.find((p) => p.id === myId);
    const desired =
      me && playing
        ? this.players.get(myId)?.root.position || me
        : {
            x: Math.sin(this.time * 0.035) * 5,
            z: Math.cos(this.time * 0.035) * 3,
          };
    if (
      playing &&
      Math.hypot(desired.x - this.target.x, desired.z - this.target.z) > 18
    ) {
      this.target.x = desired.x;
      this.target.z = desired.z;
    }
    const smoothing = 1 - Math.exp(-dt * (playing ? 8 : 1));
    this.target.x += (desired.x - this.target.x) * smoothing;
    this.target.z += (desired.z - this.target.z) * smoothing;
    const mobile = innerWidth < 700,
      height = playing ? (mobile ? 32 : 29) : 34;
    this.camera.position.set(
      this.target.x,
      this.target.y + height,
      this.target.z + (playing ? height * 0.73 : 28),
    );
    this.camera.lookAt(this.target.x, 0, this.target.z);

    if (state) {
      const ids = new Set();
      for (const p of state.players) {
        ids.add(p.id);
        let v = this.players.get(p.id);
        if (
          v &&
          (v.skin !== p.skin ||
            v.name !== p.name ||
            !sameCosmetics(v.cosmetics, p.cosmetics))
        ) {
          this.disposePlayer(v);
          this.players.delete(p.id);
          v = null;
        }
        if (!v) {
          v = this.makePlayer(p, p.id === myId);
          this.players.set(p.id, v);
        }
        v.seen = this.time;
        if (p.alive && !v.wasAlive) this.burst(p.x, p.z, v.spawnColor, 12);
        v.wasAlive = p.alive;
        v.root.visible = p.alive;
        updatePose(v.pose, p, dt);
        const guarded = p.levelGuard > 0;
        if (
          playing &&
          p.alive &&
          (p.level > v.level || (guarded && !v.guardActive))
        )
          this.burst(p.x, p.z, 0xffe49b, 18);
        if (playing && p.alive && p.level > v.level)
          this.feedback.show(p.id, `SEVİYE ${p.level}`, "level");
        v.level = p.level;
        v.guardActive = guarded;
        if (!p.alive) continue;
        v.root.position.set(v.pose.x, 0, v.pose.z);
        v.body.rotation.y = -v.pose.facing;
        v.lowerBody.rotation.y = -v.pose.moveAngle;
        const stride = Math.sin(v.pose.phase) * v.pose.weight;
        v.body.position.y =
          (1 - Math.cos(v.pose.phase * 2)) * 0.03 * v.pose.weight;
        const relative = v.pose.moveAngle - v.pose.facing;
        const forward = Math.cos(relative),
          side = Math.sin(relative);
        for (let i = 0; i < v.legs.length; i++) {
          const step = Math.sin(v.pose.phase + i * Math.PI) * v.pose.weight;
          const leg = v.legs[i];
          leg.rotation.z = step * 0.55;
          leg.rotation.x = 0;
          // Keep the stance foot on the ground; only the swinging foot lifts.
          leg.position.y =
            Math.cos(leg.rotation.x) * Math.cos(leg.rotation.z) * 0.48 +
            Math.abs(Math.cos(leg.rotation.x) * Math.sin(leg.rotation.z)) *
              0.155 +
            Math.abs(Math.sin(leg.rotation.x)) * 0.12 +
            Math.max(0, step) * 0.1;
        }
        v.body.rotation.z =
          p.dashTime > 0
            ? -0.12
            : -forward * v.pose.weight * 0.05 + stride * 0.012;
        v.body.rotation.x = side * v.pose.weight * 0.04 + v.pose.turn * 0.04;
        v.cape.rotation.z =
          -0.25 -
          v.pose.weight * 0.1 +
          Math.cos(v.pose.phase * 2) * v.pose.weight * 0.035;
        const footstep = Math.floor(v.pose.phase / Math.PI);
        if (
          footstep !== v.footstep &&
          v.pose.weight > 0.5 &&
          playing &&
          p.dashTime <= 0
        )
          this.stepDust(v.pose.x, v.pose.z);
        v.footstep = footstep;
        v.base.visible = p.id === myId || p.slowTime > 0 || p.team != null;
        v.base.material.color.set(
          p.slowTime > 0
            ? 0x90e8ff
            : p.team != null
              ? TEAMS[p.team].color
              : 0xe1f3a8,
        );
        const buff = p.buffTime > 0 ? POWERUPS[p.buffType] : null;
        v.buffType = buff ? p.buffType : null;
        v.buffRing.visible = !!buff;
        v.bowLine.material.color.set(buff ? buff.color : v.bowColor);
        const celebrating =
          state.match?.phase === "results" &&
          p.cosmetics?.pose === "pose-victory";
        v.bow.rotation.z = celebrating ? 0.8 : 0;
        v.arm.rotation.z = celebrating ? 0.8 : 0;
        if (celebrating)
          v.body.rotation.z = -0.1 + Math.sin(this.time * 2) * 0.04;
        if (buff) {
          v.buffRing.material.color.set(buff.color);
          v.buffRing.material.opacity = 0.6 + Math.sin(this.time * 4) * 0.15;
        }
        v.shield.visible = p.spawnShield > 0 || p.levelGuard > 0;
        v.shield.material.color.setHex(guarded ? 0xffe49b : 0xd5f0b1);
        v.shield.material.opacity = guarded
          ? 0.23 + Math.sin(this.time * 9) * 0.05
          : 0.13;
        v.levelEffect.visible = guarded;
        if (guarded) {
          const fraction = Math.min(1, p.levelGuard / RULES.levelGuardDuration);
          v.guardRing.geometry.setDrawRange(0, Math.ceil(fraction * 64) * 6);
          for (let i = 0; i < v.guardSparks.length; i++) {
            const phase = this.time * 1.8 + (i * Math.PI) / 3;
            const spark = v.guardSparks[i];
            spark.position.set(
              Math.cos(phase) * 0.95,
              0.35 + ((this.time * 0.75 + i / 6) % 1) * 1.6,
              Math.sin(phase) * 0.95,
            );
            spark.rotation.y = phase;
          }
        }
        v.label.visible = playing;

        if (v.drawCharge !== p.charge) {
          v.drawCharge = p.charge;
          v.string.geometry.attributes.position.setXYZ(
            1,
            -0.05 - p.charge * 0.4,
            1,
            0,
          );
          v.string.geometry.attributes.position.needsUpdate = true;
        }
        if (v.hp !== p.hp || v.maxHp !== p.maxHp || v.team !== p.team) {
          const teamChanged = v.team !== p.team;
          v.team = p.team;
          v.hp = p.hp;
          v.maxHp = p.maxHp;
          const ctx = v.canvas.getContext("2d");
          ctx.clearRect(0, 39, 256, 22);
          ctx.fillStyle = "#192e22";
          ctx.fillRect(64, 44, 128, 8);
          ctx.fillStyle =
            p.hp < p.maxHp * 0.3
              ? "#e6a181"
              : p.team != null
                ? TEAMS[p.team].color
                : "#bde08d";
          ctx.fillRect(64, 44, 128 * Math.max(0, p.hp / p.maxHp), 8);
          v.tex.needsUpdate = true;
          if (teamChanged) {
            ctx.clearRect(0, 0, 256, 38);
            ctx.textAlign = "center";
            ctx.font = "600 22px sans-serif";
            if (p.team != null) {
              ctx.fillStyle = TEAMS[p.team].color;
              ctx.fillText(
                `${TEAMS[p.team].symbol} ${p.id === myId ? "Sen" : p.name}`,
                128,
                27,
              );
            } else if (p.id !== myId) {
              ctx.fillStyle = "#eef3dc";
              ctx.shadowColor = "#142c20";
              ctx.shadowBlur = 7;
              ctx.fillText(p.name, 128, 27);
              ctx.shadowBlur = 0;
            }
          }
        }
      }
      for (const [id, v] of this.players)
        if (!ids.has(id)) {
          v.root.visible = false;
          if (this.time - (v.seen || 0) > 10) {
            this.disposePlayer(v);
            this.players.delete(id);
          }
        }
      for (let i = 0; i < this.powerupMeshes.length; i++) {
        const view = this.powerupMeshes[i],
          site = state.powerups?.[i],
          spec = site && POWERUPS[site.key];
        view.group.visible = !!spec;
        if (!spec) continue;
        view.group.position.set(site.x, 0, site.z);
        view.emblem.visible = site.cooldown <= 0;
        view.emblem.material.color.set(spec.color);
        view.emblem.material.emissive.set(spec.color);
        view.emblem.position.y = 1.1 + Math.sin(this.time * 2 + i) * 0.15;
        view.emblem.rotation.y = this.time * 0.8;
        view.ring.material.color.set(spec.color);
        view.ring.material.opacity =
          site.cooldown > 0 ? 0.18 : 0.65 + Math.sin(this.time * 3) * 0.15;
      }
      this.arrows.update(state.arrows);
      if (this.quality !== "low") {
        for (let i = 0; i < state.arrows.length; i++) {
          if ((i + Math.floor(this.time * 30)) % 8 !== 0) continue;
          const a = state.arrows[i];
          const item = COSMETICS.get(a.trail);
          if (item && item.id !== "trail-leaf")
            this.burst(a.x, a.z, item.color, 1);
        }
      }
      this.gems.count = state.orbs.length;
      let rareCount = 0;
      for (let i = 0; i < state.orbs.length; i++) {
        const o = state.orbs[i],
          m = this.gemDummy;
        m.position.set(o.x, 0.45 + Math.sin(this.time * 2 + o.id) * 0.11, o.z);
        m.scale.setScalar(o.rare ? 2.7 : o.value > RULES.orbXP ? 1.2 : 1);
        this.gems.setColorAt(
          i,
          o.rare ? this.gemColors.rare : this.gemColors.normal,
        );
        if (o.rare && rareCount < RULES.maxRareOrbs) {
          this.haloDummy.position.set(o.x, 0.045, o.z);
          this.haloDummy.scale.setScalar(
            1 + Math.sin(this.time * 2 + o.id) * 0.08,
          );
          this.haloDummy.updateMatrix();
          this.rareHalos.setMatrixAt(rareCount++, this.haloDummy.matrix);
        }
        m.rotation.y = this.time * 0.65 + o.id;
        m.updateMatrix();
        this.gems.setMatrixAt(i, m.matrix);
      }
      this.gems.instanceMatrix.needsUpdate = true;
      if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
      this.rareHalos.count = rareCount;
      this.rareHalos.instanceMatrix.needsUpdate = true;
      const objective = state.objective;
      this.shrine.visible =
        !!objective && (objective.active || objective.remaining <= 10);
      if (this.shrine.visible) {
        this.shrine.material.color.set(
          objective.contested ? 0xf58b83 : 0xffd278,
        );
        this.shrine.material.opacity = objective.active
          ? 0.55 + Math.sin(this.time * 3) * 0.15
          : 0.2;
        this.shrine.scale.setScalar(1 + (objective.progress || 0) * 0.03);
      }
    }
    const locked = lockId ? this.players.get(lockId) : null;
    this.lockRing.visible = !!(playing && locked?.root.visible);
    if (this.lockRing.visible) {
      this.lockRing.position.set(
        locked.root.position.x,
        0.06,
        locked.root.position.z,
      );
      this.lockRing.scale.setScalar(1 + Math.sin(this.time * 3) * 0.04);
    }
    this.reticle.visible = this.aimLine.visible = !!(me?.alive && playing);
    if (me?.alive && playing) {
      const origin = this.players.get(myId)?.root.position || me;
      const distance = 4 + me.charge * 10,
        tx = origin.x + Math.cos(me.angle) * distance,
        tz = origin.z + Math.sin(me.angle) * distance;
      this.reticle.position.set(tx, 0.07, tz);
      this.reticle.rotation.y = this.time * 0.6;
      const pos = this.aimLine.geometry.attributes.position;
      pos.setXYZ(0, origin.x, 0.1, origin.z);
      pos.setXYZ(1, tx, 0.1, tz);
      pos.needsUpdate = true;
      const lengths = this.aimLine.geometry.attributes.lineDistance;
      lengths.setX(
        1,
        Math.hypot(
          pos.getX(1) - pos.getX(0),
          pos.getY(1) - pos.getY(0),
          pos.getZ(1) - pos.getZ(0),
        ),
      );
      lengths.needsUpdate = true;
      this.aimLine.material.opacity = 0.17 + me.charge * 0.5;
    }
    for (const e of this.effects)
      if (e.life > 0) {
        e.life -= dt;
        e.mesh.position.x += e.vx * dt;
        e.mesh.position.z += e.vz * dt;
        e.mesh.position.y += e.vy * dt;
        e.vy -= 9 * dt;
        e.mesh.material.opacity = Math.max(0, e.life * 2);
        e.mesh.visible = e.life > 0;
        e.mesh.rotation.x += dt * 4;
      }
    this.lootView.update(state, dt);
    this.camera.updateMatrixWorld();
    this.feedback.update(this.camera, this.players, dt, playing);
    // Publish animated world transforms to the shared GPU instance buffers.
    this.scene.updateMatrixWorld();
    this.bowBuffs.update(this.players, this.time);
    this.avatarBatches.update();
    this.camera.updateMatrixWorld();
    this.particles.update(this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}
