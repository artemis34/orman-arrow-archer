import * as THREE from "three";

/** Two persistent draw calls for BR only. No per-frame geometry or particles. */
export class BattleRoyaleZoneView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.floor = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        radius: { value: 60 },
        centre: { value: new THREE.Vector2() },
      },
      vertexShader: `varying vec2 ground;
        void main() { vec4 p = modelMatrix * vec4(position, 1.0);
          ground = p.xz; gl_Position = projectionMatrix * viewMatrix * p; }`,
      fragmentShader: `uniform float radius; uniform vec2 centre; varying vec2 ground;
        void main() { float outside = smoothstep(radius - 0.08, radius + 0.08, distance(ground, centre));
          gl_FragColor = vec4(0.85, 0.12, 0.18, outside * 0.28); }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(84, 84), this.floor);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.045;
    ground.renderOrder = 2;
    this.root.add(ground);
    this.wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1.8, 96, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9be6fa,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.wall.position.y = 0.9;
    this.root.add(this.wall);
    scene.add(this.root);
  }
  update(match) {
    const zone = match?.format === "br" ? match.zone : null;
    this.root.visible = !!zone;
    if (!zone) return;
    this.floor.uniforms.radius.value = zone.radius;
    this.floor.uniforms.centre.value.set(zone.x, zone.z);
    this.wall.position.set(zone.x, 0.9, zone.z);
    this.wall.scale.set(zone.radius, 1, zone.radius);
    this.wall.visible = zone.radius > 0.01;
  }
}
