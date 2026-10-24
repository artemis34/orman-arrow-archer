import * as THREE from "three";
import { TEAMS } from "../shared/modes.js";

// CanvasTexture uses NoColorSpace here, as the original labels did. Preserve
// those raw canvas channel values instead of converting the HP colours again.
const canvasColour = (value) => new THREE.Color(value).convertLinearToSRGB();
const BACKGROUND = canvasColour("#192e22");
const HEALTHY = canvasColour("#bde08d");
const HURT = canvasColour("#e6a181");
const TEAM_COLOURS = TEAMS.map((team) => canvasColour(team.color));

const HEALTH_DECLARATIONS = `
uniform float wbLabelHealth;
uniform vec3 wbLabelHealthColour;
uniform vec3 wbLabelBackground;

float wbLabelPixelCoverage(float pixel, float edge) {
  return clamp(min(edge, pixel + 1.0) - max(64.0, pixel), 0.0, 1.0);
}
`;

const HEALTH_FRAGMENT = `
#include <map_fragment>
#ifdef USE_MAP
  // The lower half contains only the white HP mask. Keep its existing alpha
  // edge/filtering; the name and its drop shadow are sampled without changes.
  if (vMapUv.y < 0.5) {
    float texel = vMapUv.x * 256.0 - 0.5;
    float left = floor(texel);
    float blend = fract(texel);
    float full = mix(wbLabelPixelCoverage(left, 192.0),
                     wbLabelPixelCoverage(left + 1.0, 192.0), blend);
    float edge = 64.0 + 128.0 * wbLabelHealth;
    float filled = mix(wbLabelPixelCoverage(left, edge),
                       wbLabelPixelCoverage(left + 1.0, edge), blend);
    // Normalise the colour blend at the outside edges of the white mask. This
    // avoids tinting the empty bar at 0 HP or darkening the full bar at 100%.
    float fraction = full > 0.0 ? filled / full : 0.0;
    diffuseColor.rgb *= mix(wbLabelBackground, wbLabelHealthColour, fraction);
  }
#endif
`;

/** Name texture is static during combat; HP changes are three small uniforms. */
export function createPlayerLabel(
  player,
  local = false,
  createCanvas = () => document.createElement("canvas"),
) {
  const canvas = createCanvas();
  canvas.width = 256;
  canvas.height = 80;
  const ctx = canvas.getContext("2d");
  const uniforms = {
    wbLabelHealth: { value: 0 },
    wbLabelHealthColour: { value: HEALTHY.clone() },
    wbLabelBackground: { value: BACKGROUND },
  };
  let savedName = player.name,
    savedTeam = player.team ?? null;

  function paintName(next) {
    ctx.clearRect(0, 0, 256, 38);
    ctx.textAlign = "center";
    ctx.font = "600 22px sans-serif";
    ctx.shadowBlur = 0;
    const team = TEAMS[next.team];
    if (team) {
      ctx.fillStyle = team.color;
      ctx.fillText(`${team.symbol} ${local ? "Sen" : next.name}`, 128, 27);
    } else if (!local) {
      ctx.fillStyle = "#eef3dc";
      ctx.shadowColor = "#142c20";
      ctx.shadowBlur = 7;
      ctx.fillText(next.name, 128, 27);
      ctx.shadowBlur = 0;
    }
  }
  function updateHealth(next) {
    const fraction = next.hp / next.maxHp;
    uniforms.wbLabelHealth.value = Number.isFinite(fraction)
      ? Math.max(0, Math.min(1, fraction))
      : 0;
    uniforms.wbLabelHealthColour.value.copy(
      next.hp < next.maxHp * 0.3 ? HURT : TEAM_COLOURS[next.team] || HEALTHY,
    );
  }

  paintName(player);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(64, 44, 128, 8);
  updateHealth(player);
  const tex = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: tex,
    depthTest: false,
    transparent: true,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + HEALTH_DECLARATIONS)
      .replace("#include <map_fragment>", HEALTH_FRAGMENT);
  };
  material.customProgramCacheKey = () => "wildbow-player-label-health-v1";
  const label = new THREE.Sprite(material);
  label.scale.set(3.8, 1.2, 1);
  label.position.y = local ? 2.35 : 2.6;

  return {
    label,
    canvas,
    tex,
    update(next) {
      const team = next.team ?? null;
      const nameChanged = savedName !== next.name || savedTeam !== team;
      if (nameChanged) {
        paintName(next);
        savedName = next.name;
        savedTeam = team;
        tex.needsUpdate = true;
      }
      updateHealth(next);
      return nameChanged;
    },
  };
}
