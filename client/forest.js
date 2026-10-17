import * as THREE from "three";
const mesh = (geometry, material, x = 0, y = 0, z = 0, shadow = true) => {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
};
export function forestMaterials() {
  const mat = (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 1 });
  return {
    bark: mat(0x654d3c),
    wood: mat(0xc0a070),
    birch: mat(0xd1c9aa),
    canopy: [mat(0x477954), mat(0x648d53), mat(0x93a35d), mat(0xb4a260)],
    stone: mat(0x8e9e96),
    moss: mat(0x637e50),
    trail: mat(0x9b9e72),
    stem: mat(0x526d44),
    petals: [mat(0xf1d4a0), mat(0xbbafd2), mat(0xe9e7c5)],
    mushroom: mat(0xc17c59),
    rune: new THREE.MeshStandardMaterial({
      color: 0xbad8ba,
      emissive: 0x739d86,
      emissiveIntensity: 0.25,
    }),
  };
}
/** Cover shapes share the same center/radius as the authoritative collision map. */
export function forestProp(o, m) {
  const g = new THREE.Group(),
    r = o.r;
  const add = (...items) => g.add(...items);
  if (o.type === "tree") {
    const birch = o.id % 3 === 0;
    add(
      mesh(
        new THREE.CylinderGeometry(0.17 * r, 0.3 * r, 2.5 * r, 6),
        birch ? m.birch : m.bark,
        0,
        1.25 * r,
      ),
    );
    for (let i = 0; i < 3; i++) {
      const crown = mesh(
        new THREE.IcosahedronGeometry((i === 2 ? 1.25 : 0.95) * r, 0),
        m.canopy[(o.id + i) % m.canopy.length],
        Math.cos(i * 2.7) * 0.55 * r,
        (2.7 + i * 0.45) * r,
        Math.sin(i * 2.7) * 0.4 * r,
      );
      crown.scale.y = birch ? 1.18 : 0.9;
      add(crown);
    }
  } else if (o.type === "stump") {
    add(
      mesh(
        new THREE.CylinderGeometry(0.7 * r, 0.92 * r, 0.85 * r, 8),
        m.bark,
        0,
        0.425 * r,
      ),
    );
    const top = mesh(
      new THREE.CircleGeometry(0.68 * r, 12),
      m.wood,
      0,
      0.855 * r,
    );
    top.rotation.x = -Math.PI / 2;
    add(top);
    for (const radius of [0.3, 0.5]) {
      const ring = mesh(
        new THREE.RingGeometry(radius * r, (radius + 0.025) * r, 16),
        m.bark,
        0,
        0.86 * r,
        0,
        false,
      );
      ring.rotation.x = -Math.PI / 2;
      add(ring);
    }
  } else if (o.type === "log") {
    const log = mesh(
      new THREE.CylinderGeometry(0.42 * r, 0.47 * r, 1.65 * r, 8),
      m.bark,
      0,
      0.46 * r,
    );
    log.rotation.z = Math.PI / 2;
    add(log);
    for (const side of [-1, 1]) {
      const end = mesh(
        new THREE.CircleGeometry(0.4 * r, 8),
        m.wood,
        side * 0.83 * r,
        0.46 * r,
      );
      end.rotation.y = (side * Math.PI) / 2;
      add(end);
    }
  } else if (o.type === "ruin") {
    add(
      mesh(
        new THREE.BoxGeometry(0.8 * r, 1.65 * r, 0.75 * r),
        m.stone,
        -0.25 * r,
        0.825 * r,
      ),
      mesh(
        new THREE.BoxGeometry(0.65 * r, 0.65 * r, 0.9 * r),
        m.stone,
        0.45 * r,
        0.325 * r,
        0.1 * r,
      ),
    );
    const mark = mesh(
      new THREE.BoxGeometry(0.09 * r, 0.5 * r, 0.02),
      m.rune,
      -0.25 * r,
      1.05 * r,
      0.38 * r,
      false,
    );
    mark.rotation.z = -0.4;
    add(mark);
  } else if (o.type === "rock") {
    const rock = mesh(
      new THREE.DodecahedronGeometry(r, 0),
      m.stone,
      0,
      0.5 * r,
    );
    rock.scale.set(1, 0.7, 0.9);
    add(rock);
    add(
      mesh(
        new THREE.IcosahedronGeometry(0.45 * r, 0),
        m.moss,
        -0.45 * r,
        0.2,
        0.38 * r,
      ),
    );
  } else {
    for (let i = 0; i < 4; i++) {
      const bush = mesh(
        new THREE.IcosahedronGeometry(r * 0.72, 0),
        m.canopy[(o.id + i) % 3],
        Math.cos(i * 2) * r * 0.4,
        0.6,
        Math.sin(i * 2) * r * 0.4,
      );
      bush.scale.y = 0.7;
      add(bush);
    }
  }
  g.rotation.y = o.id * 1.7;
  g.position.set(o.x, 0, o.z);
  return g;
}
export function decorateForest(group, materials, obstacles) {
  let seed = 926;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Flat paths are visual landmarks and never introduce invisible collision.
  for (const vertical of [false, true]) {
    const vertices = [];
    for (let i = 0; i < 80; i++) {
      const pair = [];
      for (const x of [i - 40, i - 39]) {
        const z = Math.sin(x * 0.11) * 3.5;
        pair.push([x, 0.025, z - 0.9], [x, 0.025, z + 0.9]);
      }
      for (const n of [0, 1, 2, 2, 1, 3]) {
        const [x, y, z] = pair[n];
        vertices.push(...(vertical ? [z, y, x] : [x, y, z]));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    const path = mesh(geo, materials.trail, 0, 0, 0, false);
    // The first path's vertex order faces down; paths are thin ground decals.
    path.material.side = THREE.DoubleSide;
    group.add(path);
  }
  for (let i = 0; i < 220; i++) {
    const x = (rand() - 0.5) * 77,
      z = (rand() - 0.5) * 77;
    if (
      Math.hypot(x, z) < 4 ||
      obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 0.5)
    )
      continue;
    if (i % 4 === 0) {
      for (let j = 0; j < 4; j++) {
        const fx = x + (rand() - 0.5) * 1.2,
          fz = z + (rand() - 0.5) * 1.2;
        group.add(
          mesh(
            new THREE.CylinderGeometry(0.025, 0.035, 0.3, 3),
            materials.stem,
            fx,
            0.15,
            fz,
            false,
          ),
          mesh(
            new THREE.IcosahedronGeometry(0.12, 0),
            materials.petals[i % 3],
            fx,
            0.34,
            fz,
            false,
          ),
        );
      }
    } else if (i % 5 === 0) {
      for (let j = 0; j < 3; j++) {
        const fx = x + j * 0.24,
          fz = z + rand() * 0.3;
        group.add(
          mesh(
            new THREE.CylinderGeometry(0.055, 0.07, 0.22, 5),
            materials.wood,
            fx,
            0.11,
            fz,
            false,
          ),
          mesh(
            new THREE.ConeGeometry(0.21, 0.15, 7),
            materials.mushroom,
            fx,
            0.27,
            fz,
            false,
          ),
        );
      }
    } else {
      for (let j = 0; j < 3; j++) {
        const blade = mesh(
          new THREE.ConeGeometry(0.12, 0.45 + rand() * 0.25, 3),
          materials.stem,
          x + j * 0.13,
          0.22,
          z + rand() * 0.3,
          false,
        );
        blade.rotation.z = (rand() - 0.5) * 0.6;
        group.add(blade);
      }
    }
  }
}
