import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { POWERUPS, POWERUP_RULES } from "../shared/powerups.js";

function paint(geometry, color) {
  const rgb = new THREE.Color(color),
    count = geometry.attributes.position.count,
    colors = new Float32Array(count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = rgb.r;
    colors[i + 1] = rgb.g;
    colors[i + 2] = rgb.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function badgeGeometry(key, color) {
  const points =
    key === "haste"
      ? [
          [-0.04, 0.33],
          [-0.25, -0.02],
          [-0.04, -0.02],
          [-0.15, -0.33],
          [0.25, 0.09],
          [0.04, 0.09],
          [0.15, 0.33],
        ]
      : [
          [-0.085, -0.27],
          [0.085, -0.27],
          [0.085, 0.04],
          [0.25, 0.04],
          [0, 0.32],
          [-0.25, 0.04],
          [-0.085, 0.04],
        ];
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) shape.lineTo(...points[i]);
  shape.closePath();
  const pieces = [
    paint(new THREE.CircleGeometry(0.53, 32), color),
    paint(new THREE.CircleGeometry(0.47, 32).translate(0, 0, 0.001), 0x15362b),
    paint(new THREE.ShapeGeometry(shape).translate(0, 0, 0.002), 0xf6ffec),
  ];
  const result = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return result;
}

/** Two pooled objectives in six draws total, matching the previous budget.
 * Geometry and colors are reused. Only the small readable public-objective
 * badges ignore depth; ground rings, beams and gems retain normal occlusion.
 */
export class PowerupView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.capacity = POWERUP_RULES.count;
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.colors = Object.fromEntries(
      Object.entries(POWERUPS).map(([key, spec]) => [
        key,
        new THREE.Color(spec.color),
      ]),
    );
    const batch = (geometry, material) => {
      const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < this.capacity; i++) mesh.setColorAt(i, this.color);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.root.add(mesh);
      return mesh;
    };
    this.pads = batch(
      new THREE.RingGeometry(0.45, 0.95, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    );
    this.rings = batch(
      new THREE.RingGeometry(0.98, 1.08, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    this.gems = batch(
      new THREE.OctahedronGeometry(0.44, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x617d73,
        emissiveIntensity: 0.35,
        roughness: 0.35,
        metalness: 0.1,
      }),
    );
    this.beams = batch(
      new THREE.CylinderGeometry(0.055, 0.16, 2.35, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.batches = [this.pads, this.rings, this.gems, this.beams];
    this.rings.material.forceSinglePass = true;
    this.beams.material.forceSinglePass = true;
    this.badgeMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.badgeMaterial.forceSinglePass = true;
    this.badgeGeometries = Object.fromEntries(
      Object.entries(POWERUPS).map(([key, spec]) => [
        key,
        badgeGeometry(key, spec.color),
      ]),
    );
    this.badges = Array.from({ length: this.capacity }, () => {
      const items = {};
      for (const [key, geometry] of Object.entries(this.badgeGeometries)) {
        const mesh = new THREE.Mesh(geometry, this.badgeMaterial);
        mesh.visible = false;
        mesh.renderOrder = 8;
        this.root.add(mesh);
        items[key] = mesh;
      }
      return items;
    });
  }
  update(sites, time, camera) {
    let count = 0,
      live = 0;
    for (let i = 0; i < this.capacity; i++) {
      const site = sites?.[i],
        spec = site && POWERUPS[site.key];
      const ready = !!spec && site.cooldown <= 0;
      const badges = this.badges[i];
      for (const key in badges) badges[key].visible = ready && key === site.key;
      if (!spec) continue;
      const base = this.colors[site.key];
      this.dummy.position.set(site.x, 0.045, site.z);
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.pads.setMatrixAt(count, this.dummy.matrix);
      this.rings.setMatrixAt(count, this.dummy.matrix);
      this.color.copy(base).multiplyScalar(ready ? 0.3 : 0.14);
      this.pads.setColorAt(count, this.color);
      this.color.copy(base).multiplyScalar(ready ? 1 : 0.22);
      this.rings.setColorAt(count, this.color);
      if (ready) {
        this.dummy.rotation.set(0, time * 0.8, 0);
        this.dummy.position.y = 0.9 + Math.sin(time * 2 + i) * 0.13;
        this.dummy.updateMatrix();
        this.gems.setMatrixAt(live, this.dummy.matrix);
        this.gems.setColorAt(live, base);
        this.dummy.position.y = 1.22;
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.beams.setMatrixAt(live, this.dummy.matrix);
        this.beams.setColorAt(live, base);
        const badge = badges[site.key];
        badge.position.set(
          site.x,
          2.65 + Math.sin(time * 2 + i) * 0.08,
          site.z,
        );
        if (camera) badge.quaternion.copy(camera.quaternion);
        live++;
      }
      count++;
    }
    this.root.visible = count > 0;
    this.pads.count = this.rings.count = count;
    this.gems.count = this.beams.count = live;
    this.gems.visible = this.beams.visible = live > 0;
    this.rings.material.opacity = 0.72 + Math.sin(time * 3) * 0.1;
    for (const mesh of this.batches) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }
}
