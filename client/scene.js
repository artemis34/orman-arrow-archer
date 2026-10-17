import { forestMaterials, forestProp, decorateForest } from "./forest.js";
import { createPose, updatePose } from "./presentation.js";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RULES, SKINS } from "../shared/config.js";
const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** All dynamic meshes are created once and reused across snapshots. */
export class ArenaScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: devicePixelRatio < 2,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x547d5a);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x607f60, 0.008);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
    this.camera.position.set(0, 34, 28);
    this.target = new THREE.Vector3();
    this.players = new Map();
    this.arrowMeshes = [];
    this.orbMeshes = [];
    this.effects = [];
    this.ray = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(Y_AXIS, 0);
    this.pointer = new THREE.Vector2();
    this.intersection = new THREE.Vector3();
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
    sun.shadow.mapSize.set(2048, 2048);
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
    for (let i = 0; i < 210; i++) {
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(1 + rand() * 3, 7),
        patchMaterials[i % 2],
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set((rand() - 0.5) * 100, 0.015, (rand() - 0.5) * 100);
      this.staticGroup.add(patch);
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
    const arrowGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.1, 5);
    arrowGeo.rotateZ(Math.PI / 2);
    const headGeo = new THREE.ConeGeometry(0.14, 0.35, 3);
    headGeo.rotateZ(-Math.PI / 2);
    headGeo.translate(0.68, 0, 0);
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xf9e1ab });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe7f1c5 });
    for (let i = 0; i < RULES.maxArrows; i++) {
      const g = new THREE.Group();
      g.add(
        new THREE.Mesh(arrowGeo, arrowMat),
        new THREE.Mesh(headGeo, headMat),
      );
      g.visible = false;
      this.scene.add(g);
      this.arrowMeshes.push(g);
    }
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
    this.haloDummy = new THREE.Object3D();
    this.haloDummy.rotation.x = -Math.PI / 2;
    const effectGeo = new THREE.OctahedronGeometry(0.11);
    for (let i = 0; i < 140; i++) {
      const mesh = new THREE.Mesh(
        effectGeo,
        new THREE.MeshBasicMaterial({ color: 0xd8f5a3, transparent: true }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.effects.push({ mesh, life: 0, vx: 0, vz: 0, vy: 0 });
    }
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
    this.aimLine.visible = false;
    this.resize();
    addEventListener("resize", () => this.resize());
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
    if (this.built) return;
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
    v.root.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    v.tex.dispose();
    this.scene.remove(v.root);
  }
  makePlayer(p) {
    const root = new THREE.Group(),
      body = new THREE.Group();
    root.add(body);
    const skin = SKINS[p.skin] || SKINS[0],
      cloth = new THREE.MeshStandardMaterial({ color: skin.body }),
      cape = new THREE.MeshStandardMaterial({
        color: skin.cape,
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
      cape,
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
      body.add(hip);
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
      new THREE.LineBasicMaterial({ color: 0xe7bf79 }),
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
    root.add(base);
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
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 256;
    labelCanvas.height = 80;
    const ctx = labelCanvas.getContext("2d");
    ctx.textAlign = "center";
    ctx.font = "600 22px sans-serif";
    ctx.fillStyle = "#eef3dc";
    ctx.shadowColor = "#142c20";
    ctx.shadowBlur = 7;
    ctx.fillText(p.name, 128, 27);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#192e22";
    ctx.fillRect(64, 44, 128, 8);
    ctx.fillStyle = "#bde08d";
    ctx.fillRect(64, 44, 128, 8);
    const tex = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        depthTest: false,
        transparent: true,
      }),
    );
    label.scale.set(3.8, 1.2, 1);
    label.position.y = 2.6;
    root.add(label);
    this.scene.add(root);
    return {
      root,
      body,
      legs,
      bow,
      string,
      base,
      shield,
      label,
      canvas: labelCanvas,
      tex,
      pose: createPose(p),
      hp: p.hp,
      skin: p.skin,
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
      e.vx = (Math.random() - 0.5) * 5;
      e.vz = (Math.random() - 0.5) * 5;
      e.vy = 2 + Math.random() * 3;
      e.mesh.visible = true;
      if (++done >= count) break;
    }
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
        if (v && (v.skin !== p.skin || v.name !== p.name)) {
          this.disposePlayer(v);
          this.players.delete(p.id);
          v = null;
        }
        if (!v) {
          v = this.makePlayer(p);
          this.players.set(p.id, v);
        }
        v.seen = this.time;
        v.root.visible = p.alive;
        updatePose(v.pose, p, dt);
        if (!p.alive) continue;
        v.root.position.set(v.pose.x, 0, v.pose.z);
        const delta = Math.atan2(
          Math.sin(-p.angle - v.body.rotation.y),
          Math.cos(-p.angle - v.body.rotation.y),
        );
        v.body.rotation.y += delta * Math.min(1, dt * 22);
        const stride = Math.sin(v.pose.phase) * v.pose.weight;
        v.body.position.y =
          (1 - Math.cos(v.pose.phase * 2)) * 0.012 * v.pose.weight;
        v.legs[0].rotation.z = stride * 0.32;
        v.legs[1].rotation.z = -stride * 0.32;
        v.body.rotation.z = p.dashTime > 0 ? -0.12 : stride * 0.015;
        v.base.visible = p.id === myId;
        v.shield.visible = p.spawnShield > 0;
        v.label.visible = playing;

        v.string.geometry.attributes.position.setXYZ(
          1,
          -0.05 - p.charge * 0.4,
          1,
          0,
        );
        v.string.geometry.attributes.position.needsUpdate = true;
        if (v.hp !== p.hp) {
          v.hp = p.hp;
          const ctx = v.canvas.getContext("2d");
          ctx.clearRect(0, 39, 256, 22);
          ctx.fillStyle = "#192e22";
          ctx.fillRect(64, 44, 128, 8);
          ctx.fillStyle = p.hp < p.maxHp * 0.3 ? "#e6a181" : "#bde08d";
          ctx.fillRect(64, 44, 128 * Math.max(0, p.hp / p.maxHp), 8);
          v.tex.needsUpdate = true;
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
      for (let i = 0; i < this.arrowMeshes.length; i++) {
        const m = this.arrowMeshes[i],
          a = state.arrows[i];
        m.visible = !!a;
        if (a) {
          m.position.set(a.x, 1, a.z);
          m.rotation.y = -a.angle;
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
      this.aimLine.computeLineDistances();
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
    this.renderer.render(this.scene, this.camera);
  }
}
