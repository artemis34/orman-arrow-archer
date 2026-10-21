import * as THREE from "three";
/** Bounded labels: no per-event texture/geometry allocation. */
export class CombatFeedback {
  constructor(scene) {
    this.point = new THREE.Vector3();
    this.layer = document.createElement("div");
    this.layer.className = "combat-feedback";
    this.layer.setAttribute("aria-hidden", "true");
    document.body.append(this.layer);
    this.labels = Array.from({ length: 24 }, () => {
      const node = document.createElement("span");
      node.hidden = true;
      this.layer.append(node);
      return { node, life: 0 };
    });
    const geometry = new THREE.RingGeometry(0.6, 0.9, 6);
    this.rings = Array.from({ length: 4 }, () => {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: 0xff9970,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, life: 0 };
    });
  }
  show(owner, text, kind = "level", point = null) {
    const label =
      this.labels.find(
        (l) => l.life > 0 && l.owner === owner && l.kind === kind,
      ) ||
      this.labels.find((l) => l.life <= 0) ||
      this.labels.reduce((a, b) => (a.life < b.life ? a : b));
    label.owner = owner;
    label.kind = kind;
    label.offset =
      this.labels.filter((l) => l !== label && l.life > 0 && l.owner === owner)
        .length * 16;
    label.point = point;
    label.life = 1.1;
    label.node.textContent = text;
    label.node.className = `combat-word word-${kind}`;
    label.node.hidden = false;
    label.node.getAnimations().forEach((a) => a.cancel());
    label.node.animate(
      [
        { opacity: 0, transform: "translate(-50%,-80%) scale(.8)" },
        {
          opacity: 1,
          offset: 0.15,
          transform: "translate(-50%,-110%) scale(1.05)",
        },
        { opacity: 0, transform: "translate(-50%,-240%) scale(1)" },
      ],
      { duration: 1100, easing: "ease-out" },
    );
  }
  kill(owner, x, z) {
    this.show(owner, "Kill", "kill");
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const ring = this.rings.find((r) => r.life <= 0) || this.rings[0];
    ring.life = 0.5;
    ring.mesh.position.set(x, 0.12, z);
    ring.mesh.visible = true;
  }
  update(camera, players, dt, playing) {
    for (const label of this.labels) {
      label.life -= dt;
      const player = players.get(label.owner);
      if (
        label.life <= 0 ||
        !playing ||
        (!player?.root.visible && !label.point)
      ) {
        label.node.hidden = true;
        continue;
      }
      const p = player?.root.position || label.point;
      this.point.set(p.x, 3.6, p.z).project(camera);
      label.node.hidden = this.point.z > 1 || this.point.z < -1;
      label.node.style.left = `${((this.point.x + 1) * innerWidth) / 2}px`;
      label.node.style.top = `${((1 - this.point.y) * innerHeight) / 2 - label.offset}px`;
    }
    for (const ring of this.rings) {
      ring.life -= dt;
      ring.mesh.visible = playing && ring.life > 0;
      if (ring.life > 0) {
        ring.mesh.scale.setScalar(1 + (1 - ring.life / 0.5) * 2.7);
        ring.mesh.material.opacity = ring.life * 1.5;
        ring.mesh.rotation.z += dt * 3;
      }
    }
  }
}
