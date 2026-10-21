import * as THREE from "three";
/** Three reusable parachutes, with display-rate falling height. */
export class LootView {
  constructor(scene) {
    const box = new THREE.BoxGeometry(0.85, 0.7, 0.85),
      canopy = new THREE.SphereGeometry(
        1.2,
        8,
        4,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      );
    const crateMat = new THREE.MeshStandardMaterial({ color: 0xb98048 }),
      trimMat = new THREE.MeshStandardMaterial({
        color: 0xffd77e,
        emissive: 0x60411a,
        emissiveIntensity: 0.4,
      }),
      parachuteMat = new THREE.MeshStandardMaterial({
        color: 0xefdbaa,
        side: THREE.DoubleSide,
      });
    const bandGeo = new THREE.BoxGeometry(0.18, 0.73, 0.89),
      ringGeo = new THREE.RingGeometry(0.9, 1.03, 24);
    this.items = Array.from({ length: 3 }, () => {
      const root = new THREE.Group(),
        crate = new THREE.Mesh(box, crateMat),
        band = new THREE.Mesh(bandGeo, trimMat);
      crate.castShadow = true;
      root.add(crate, band);
      const parachute = new THREE.Group(),
        dome = new THREE.Mesh(canopy, parachuteMat);
      dome.position.y = 2.4;
      parachute.add(dome);
      const points = [];
      for (const [x, z] of [
        [-0.8, -0.8],
        [0.8, -0.8],
        [-0.8, 0.8],
        [0.8, 0.8],
      ])
        points.push(
          new THREE.Vector3(x, 2.4, z),
          new THREE.Vector3(x * 0.4, 0.3, z * 0.4),
        );
      parachute.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0xe9e3bf }),
        ),
      );
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffd77e,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      root.add(parachute);
      scene.add(root, ring);
      root.visible = ring.visible = false;
      return { root, ring, parachute };
    });
    this.time = 0;
  }
  update(state, dt) {
    this.time += dt;
    if (state && Math.abs(state.time - this.time) > 0.3) this.time = state.time;
    const drops = state?.objective?.drops || [];
    for (let i = 0; i < this.items.length; i++) {
      const v = this.items[i],
        d = drops[i];
      v.root.visible = v.ring.visible = !!d;
      if (!d) continue;
      const fall = Math.max(0, Math.min(1, (d.landAt - this.time) / 6));
      v.root.position.set(d.x, 0.5 + fall * 13, d.z);
      v.parachute.visible = fall > 0;
      v.root.rotation.y = fall
        ? Math.sin(this.time * 0.8) * 0.15
        : this.time * 0.25;
      v.ring.position.set(d.x, 0.09, d.z);
      v.ring.scale.setScalar(1 + Math.sin(this.time * 3) * 0.1);
    }
  }
}
