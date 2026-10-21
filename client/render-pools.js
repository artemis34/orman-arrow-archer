import * as THREE from "three";

/** Keep the animated hierarchy, but submit matching parts in one draw.
 * Per-instance matrices/colors retain each archer's pose, skin and shadows.
 * These batches own the shared geometries; departing avatars must not dispose them.
 */
export class AvatarBatches {
  constructor(scene, capacity = 48) {
    this.scene = scene;
    this.capacity = capacity;
    this.batches = new Map();
  }
  add(root) {
    root.traverse((part) => {
      const material = part.material;
      if (
        !part.isMesh ||
        (!(material.isMeshStandardMaterial && !material.transparent) &&
          !part.userData.instanceGround)
      )
        return;
      const geometry = part.geometry;
      const key = `${geometry.type}:${JSON.stringify(geometry.parameters)}:${material.type}:${material.side}:${material.roughness}:${material.metalness}:${part.castShadow}`;
      let batch = this.batches.get(key);
      if (!batch) {
        const sharedMaterial = material.clone();
        sharedMaterial.color.setHex(0xffffff);
        const mesh = new THREE.InstancedMesh(
          geometry,
          sharedMaterial,
          this.capacity,
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = part.castShadow;
        mesh.receiveShadow = part.receiveShadow;
        mesh.frustumCulled = false;
        mesh.count = 0;
        this.scene.add(mesh);
        batch = { mesh, parts: [], colors: [] };
        this.batches.set(key, batch);
      } else if (geometry !== batch.mesh.geometry) {
        geometry.dispose();
        part.geometry = batch.mesh.geometry;
      }
      part.userData.batched = true;
      // Keep visibility available to the animation; only the batch draws layer 0.
      part.layers.disable(0);
      batch.parts.push({ root, part });
      if (batch.parts.length > batch.mesh.instanceMatrix.count) {
        const old = batch.mesh;
        const mesh = new THREE.InstancedMesh(
          old.geometry,
          old.material,
          old.instanceMatrix.count * 2,
        );
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = old.castShadow;
        mesh.receiveShadow = old.receiveShadow;
        mesh.frustumCulled = false;
        this.scene.remove(old);
        old.dispose();
        this.scene.add(mesh);
        batch.mesh = mesh;
        batch.colors.length = 0;
      }
    });
  }
  remove(root) {
    for (const batch of this.batches.values()) {
      batch.parts = batch.parts.filter((entry) => entry.root !== root);
      batch.colors.length = 0;
    }
  }
  update() {
    for (const { mesh, parts, colors } of this.batches.values()) {
      let count = 0;
      let colorsChanged = false;
      for (const { root, part } of parts) {
        if (!root.visible || !part.visible) continue;
        mesh.setMatrixAt(count, part.matrixWorld);
        const color = part.material.color;
        const previous = colors[count];
        if (
          !previous ||
          previous.part !== part ||
          previous.r !== color.r ||
          previous.g !== color.g ||
          previous.b !== color.b
        ) {
          mesh.setColorAt(count, color);
          colors[count] = { part, r: color.r, g: color.g, b: color.b };
          colorsChanged = true;
        }
        count++;
      }
      mesh.count = count;
      if (count) {
        mesh.instanceMatrix.needsUpdate = true;
        if (colorsChanged) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

/** One shaft draw + one draw per elemental head, independent of arrow count. */
export class ArrowBatches {
  constructor(scene, capacity) {
    const shaft = new THREE.CylinderGeometry(0.045, 0.045, 1.1, 5);
    shaft.rotateZ(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.14, 0.35, 3);
    head.rotateZ(-Math.PI / 2);
    head.translate(0.68, 0, 0);
    this.shafts = this.mesh(
      scene,
      shaft,
      new THREE.MeshStandardMaterial({ color: 0xf9e1ab }),
      capacity,
    );
    this.heads = Object.fromEntries(
      Object.entries({
        normal: 0xe7f1c5,
        frost: 0x8cdfff,
        blast: 0xffae67,
        poison: 0xc1a0ed,
      }).map(([key, color]) => [
        key,
        this.mesh(
          scene,
          head,
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.15,
          }),
          capacity,
        ),
      ]),
    );
    this.dummy = new THREE.Object3D();
    this.headMeshes = Object.values(this.heads);
  }
  mesh(scene, geometry, material, capacity) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  }
  update(arrows) {
    this.shafts.count = Math.min(
      arrows.length,
      this.shafts.instanceMatrix.count,
    );
    for (const mesh of this.headMeshes) mesh.count = 0;
    for (let i = 0; i < this.shafts.count; i++) {
      const arrow = arrows[i];
      this.dummy.position.set(arrow.x, 1, arrow.z);
      this.dummy.rotation.y = -arrow.angle;
      this.dummy.updateMatrix();
      this.shafts.setMatrixAt(i, this.dummy.matrix);
      const head = this.heads[arrow.effect] || this.heads.normal;
      head.setMatrixAt(head.count++, this.dummy.matrix);
    }
    this.shafts.instanceMatrix.needsUpdate = true;
    for (const mesh of this.headMeshes)
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Preserve every pooled particle's shape, color, rotation and fade in one draw. */
export class ParticleBatch {
  constructor(scene, effects, geometry) {
    this.effects = effects;
    this.active = [];
    this.opacity = new THREE.InstancedBufferAttribute(
      new Float32Array(effects.length),
      1,
    );
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("instanceOpacity", this.opacity);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float instanceOpacity;\nvarying float particleOpacity;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nparticleOpacity = instanceOpacity;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float particleOpacity;",
        )
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\ndiffuseColor.a *= particleOpacity;",
        );
    };
    material.customProgramCacheKey = () => "pooled-particle-opacity-v1";
    this.mesh = new THREE.InstancedMesh(geometry, material, effects.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(effects.length * 3),
      3,
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  update(camera) {
    this.active.length = 0;
    const view = camera.matrixWorldInverse.elements;
    for (const effect of this.effects) {
      if (effect.life <= 0) continue;
      const { x, y, z } = effect.mesh.position;
      effect.depth = view[2] * x + view[6] * y + view[10] * z + view[14];
      this.active.push(effect);
    }
    // Match the individual transparent meshes' back-to-front draw order.
    this.active.sort((a, b) => a.depth - b.depth);
    this.mesh.count = this.active.length;
    for (let i = 0; i < this.active.length; i++) {
      const source = this.active[i].mesh;
      source.updateMatrix();
      this.mesh.setMatrixAt(i, source.matrix);
      this.mesh.setColorAt(i, source.material.color);
      this.opacity.setX(i, source.material.opacity);
    }
    if (this.mesh.count) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
      this.opacity.needsUpdate = true;
    }
  }
}
