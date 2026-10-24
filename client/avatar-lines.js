import * as THREE from "three";
import { publishInstanceRange } from "./instance-updates.js";

const MATERIAL_FLAGS = [
  "opacity",
  "linewidth",
  "blending",
  "depthTest",
  "depthWrite",
  "depthFunc",
  "colorWrite",
  "fog",
  "toneMapped",
  "premultipliedAlpha",
  "alphaTest",
  "alphaHash",
  "alphaToCoverage",
  "stencilWrite",
  "polygonOffset",
  "dithering",
];

/** Preserve opaque one-pixel bow/string strips in one world-space line draw. */
export class AvatarLines {
  constructor(scene, capacity = 1024) {
    this.scene = scene;
    this.roots = new Map();
    this.active = [];
    this.point = new THREE.Vector3();
    this.material = new THREE.LineBasicMaterial({ vertexColors: true });
    this.mesh = new THREE.LineSegments(undefined, this.material);
    this.mesh.name = "avatar-bows-and-strings";
    this.mesh.frustumCulled = false;
    // Buffer positions already contain each source's full world transform.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
    this.mesh.visible = false;
    this.capacity = 0;
    this.resize(Math.max(1, Math.floor(capacity)));
    scene.add(this.mesh);
  }

  compatible(line) {
    const material = line.material;
    if (
      !line.isLine ||
      line.isLineSegments ||
      line.isLineLoop ||
      line.renderOrder !== 0 ||
      line.castShadow ||
      line.receiveShadow ||
      line.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
      line.onAfterRender !== THREE.Object3D.prototype.onAfterRender ||
      !material?.isLineBasicMaterial ||
      material.isLineDashedMaterial ||
      material.transparent ||
      material.vertexColors ||
      !material.visible ||
      material.map ||
      material.clippingPlanes ||
      material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
    )
      return false;
    if (typeof line.geometry.attributes.position?.getX !== "function")
      return false;
    for (const key of MATERIAL_FLAGS)
      if (material[key] !== this.material[key]) return false;
    for (const key in line.geometry.morphAttributes) return false;
    return true;
  }

  add(root) {
    if (this.roots.has(root)) return;
    const parts = [];
    root.traverse((line) => {
      if (!this.compatible(line) || !line.layers.isEnabled(0)) return;
      line.layers.disable(0);
      // These geometries remain owned/disposed by the original avatar.
      parts.push({ line, owned: true });
    });
    this.roots.set(root, { root, parts });
  }

  remove(root) {
    const record = this.roots.get(root);
    if (!record) return;
    const { parts } = record;
    for (const part of parts) if (part.owned) part.line.layers.enable(0);
    this.roots.delete(root);
    this.active.length = 0;
    this.mesh.visible = false;
  }

  resize(required) {
    if (required <= this.capacity) return;
    let capacity = Math.max(1, this.capacity);
    while (capacity < required) capacity *= 2;
    this.capacity = capacity;
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(
      new Float32Array(capacity * 3),
      3,
    );
    this.colors = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.positions);
    geometry.setAttribute("color", this.colors);
    geometry.setDrawRange(0, 0);
    const old = this.mesh.geometry;
    this.mesh.geometry = geometry;
    old.dispose();
  }

  update() {
    this.active.length = 0;
    let count = 0;
    for (const { root, parts } of this.roots.values()) {
      if (!root.visible) continue;
      for (const part of parts) {
        const line = part.line;
        if (!this.compatible(line)) {
          if (part.owned) line.layers.enable(0);
          part.owned = false;
          continue;
        }
        if (!part.owned && !line.layers.isEnabled(0)) continue;
        part.owned = true;
        line.layers.disable(0);
        let visible = true;
        for (let node = line; node; node = node.parent)
          if (!node.visible) {
            visible = false;
            break;
          }
        if (!visible) continue;
        const geometry = line.geometry;
        const position = geometry.attributes.position;
        if (!position) continue;
        const available = geometry.index?.count ?? position.count;
        const start = Math.max(0, geometry.drawRange.start);
        const end = Math.min(available, start + geometry.drawRange.count);
        if (end - start < 2) continue;
        part.start = start;
        part.end = end;
        this.active.push(part);
        count += (end - start - 1) * 2;
      }
    }
    this.resize(count);
    let vertex = 0;
    let colorsChanged = false;
    for (const { line, start, end } of this.active) {
      const position = line.geometry.attributes.position;
      const indices = line.geometry.index;
      const color = line.material.color;
      const r = Math.fround(color.r);
      const g = Math.fround(color.g);
      const b = Math.fround(color.b);
      for (let i = start; i < end - 1; i++)
        for (let edge = 0; edge < 2; edge++) {
          const index = indices ? indices.getX(i + edge) : i + edge;
          this.point
            .fromBufferAttribute(position, index)
            .applyMatrix4(line.matrixWorld);
          this.positions.setXYZ(
            vertex,
            this.point.x,
            this.point.y,
            this.point.z,
          );
          const offset = vertex * 3;
          if (
            this.colors.array[offset] !== r ||
            this.colors.array[offset + 1] !== g ||
            this.colors.array[offset + 2] !== b
          ) {
            this.colors.setXYZ(vertex, r, g, b);
            colorsChanged = true;
          }
          vertex++;
        }
    }
    this.mesh.geometry.setDrawRange(0, vertex);
    this.mesh.visible = vertex > 0;
    publishInstanceRange(this.positions, vertex);
    if (colorsChanged) publishInstanceRange(this.colors, vertex);
  }

  dispose() {
    for (const root of this.roots.keys()) this.remove(root);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.mesh);
  }
}
