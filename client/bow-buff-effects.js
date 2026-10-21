import * as THREE from "three";

// One shared draw per effect, regardless of how many archers have the buff.
// All animation runs on the GPU; only each visible bow's matrix is uploaded.
function quads(count, attributes) {
  const geometry = new THREE.BufferGeometry(),
    positions = [],
    uvs = [],
    indices = [];
  const values = Object.fromEntries(
    Object.keys(attributes).map((key) => [key, []]),
  );
  for (let i = 0; i < count; i++) {
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      positions.push(0, 0, 0);
      uvs.push(x, y);
      for (const [key, spec] of Object.entries(attributes))
        values[key].push(...spec.value(i));
    }
    const v = i * 4;
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  for (const [key, spec] of Object.entries(attributes))
    geometry.setAttribute(
      key,
      new THREE.Float32BufferAttribute(values[key], spec.size),
    );
  geometry.setIndex(indices);
  return geometry;
}
const fireVertex = `
  uniform float uTime;
  attribute vec3 aAnchor;
  attribute float aSeed;
  attribute float aEmber;
  varying vec2 vUv;
  varying float vSeed;
  varying float vEmber;
  varying float vFade;
  void main() {
    vUv = uv; vSeed = aSeed; vEmber = aEmber;
    float phase = aSeed * 6.28318 + instanceMatrix[3].x * .13;
    vec4 centre = modelViewMatrix * instanceMatrix * vec4(aAnchor, 1.);
    float rise = fract(uTime * (.7 + aSeed * .35) + aSeed);
    float height = .36 + .3 * (.5 + .5 * sin(uTime * 7. + phase));
    float width = .32 + .08 * sin(uTime * 5. + phase);
    vec2 offset = vec2((uv.x - .5) * width + sin(uTime * 6. + phase) * uv.y * .08, uv.y * height);
    if (aEmber > .5) {
      offset = (uv - .5) * (.045 + .025 * sin(phase));
      offset += vec2(sin(phase + rise * 4.) * .16, .25 + rise * .85);
    }
    vFade = aEmber > .5 ? (1. - rise) : 1.;
    centre.xy += offset;
    gl_Position = projectionMatrix * centre;
  }
`;
const fireFragment = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  varying float vEmber;
  varying float vFade;
  void main() {
    float y = vUv.y;
    float x = (vUv.x - .5) * 2. + sin(y * 10. - uTime * 10. + vSeed * 20.) * y * .4;
    float width = (1. - y) * .9 + sin(y * 3.14159) * .15;
    float alpha = (1. - smoothstep(width * .4, width + .03, abs(x))) * (1. - smoothstep(.8, 1., y));
    float core = clamp((1. - abs(x) * 1.7) * (1. - y) * 1.65, 0., 1.);
    vec3 color = mix(vec3(1., .16, .008), vec3(1., .88, .22), core);
    if (vEmber > .5) {
      alpha = 1. - smoothstep(.18, .5, length(vUv - .5));
      color = vec3(1., .63, .11);
    }
    gl_FragColor = vec4(color, alpha * vFade * .92);
    #include <colorspace_fragment>
  }
`;
const electricVertex = `
  uniform float uTime;
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aKnot;
  attribute float aArc;
  varying vec2 vUv;
  varying float vPulse;
  vec3 jitter(vec3 point, float knot) {
    float tick = floor(uTime * 14.);
    float phase = knot * 7.13 + aArc * 19. + tick * 5.71;
    float strength = sin(knot / 18. * 3.14159) * .09;
    return point + vec3(sin(phase), cos(phase * 1.3) * .8, sin(phase * 1.7)) * strength;
  }
  void main() {
    vUv = uv;
    vPulse = .75 + .25 * sin(uTime * 19. + aArc * 4.);
    vec4 start = modelViewMatrix * instanceMatrix * vec4(jitter(aStart, aKnot), 1.);
    vec4 end = modelViewMatrix * instanceMatrix * vec4(jitter(aEnd, aKnot + 1.), 1.);
    vec2 direction = end.xy - start.xy;
    vec2 normal = vec2(-direction.y, direction.x) / max(.0001, length(direction));
    vec4 point = mix(start, end, uv.x);
    point.xy += normal * (uv.y - .5) * .13;
    gl_Position = projectionMatrix * point;
  }
`;
const electricFragment = `
  varying vec2 vUv;
  varying float vPulse;
  void main() {
    float edge = abs(vUv.y - .5) * 2.;
    float halo = 1. - smoothstep(.05, 1., edge);
    float core = 1. - smoothstep(.08, .3, edge);
    vec3 color = mix(vec3(.08, .48, 1.), vec3(.86, .98, 1.), core);
    gl_FragColor = vec4(color, (halo * .6 + core * .4) * vPulse);
    #include <colorspace_fragment>
  }
`;
const bowPoint = (arc, knot) => {
  const t = knot / 18,
    angle = -Math.PI / 2 + t * Math.PI;
  if (arc === 1)
    return [0.02 + Math.sin(t * Math.PI) * 0.08, 1.04, -0.72 + t * 1.44];
  return [
    Math.cos(angle) * (0.48 + arc * 0.045),
    1 + arc * 0.035,
    Math.sin(angle) * 0.72,
  ];
};

export class BowBuffEffects {
  constructor(scene, capacity = 48) {
    this.capacity = capacity;
    const fire = quads(18, {
      aAnchor: { size: 3, value: (i) => bowPoint(0, ((i % 12) / 11) * 18) },
      aSeed: { size: 1, value: (i) => [(i * 0.618034) % 1] },
      aEmber: { size: 1, value: (i) => [i >= 12 ? 1 : 0] },
    });
    const lightning = quads(54, {
      aStart: { size: 3, value: (i) => bowPoint(Math.floor(i / 18), i % 18) },
      aEnd: {
        size: 3,
        value: (i) => bowPoint(Math.floor(i / 18), (i % 18) + 1),
      },
      aKnot: { size: 1, value: (i) => [i % 18] },
      aArc: { size: 1, value: (i) => [Math.floor(i / 18)] },
    });
    this.fire = this.mesh(
      scene,
      fire,
      fireVertex,
      fireFragment,
      false,
      "bow-power-flames",
    );
    this.lightning = this.mesh(
      scene,
      lightning,
      electricVertex,
      electricFragment,
      true,
      "bow-haste-lightning",
    );
    this.meshes = [this.fire, this.lightning];
  }
  mesh(scene, geometry, vertexShader, fragmentShader, additive, name) {
    const mesh = new THREE.InstancedMesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
      }),
      this.capacity,
    );
    mesh.name = name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    return mesh;
  }
  update(players, time) {
    this.fire.count = this.lightning.count = 0;
    for (const view of players.values()) {
      if (!view.root.visible) continue;
      const mesh =
        view.buffType === "power"
          ? this.fire
          : view.buffType === "haste"
            ? this.lightning
            : null;
      if (mesh && mesh.count < this.capacity)
        mesh.setMatrixAt(mesh.count++, view.bow.matrixWorld);
    }
    for (const mesh of this.meshes) {
      mesh.visible = mesh.count > 0;
      mesh.material.uniforms.uTime.value = time;
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
