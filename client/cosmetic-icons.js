/** Small inline vectors keep the collection readable on mobile font stacks. */
export function cosmeticIcon(slot) {
  const paths = {
    bow: ["M11 4 Q31 24 11 44 L19 24 Z", "M4 39 L39 4 M30 4 H39 V13"],
    cape: ["M15 7 L33 7 L43 41 Q24 33 5 41 Z", "M16 7 Q24 16 32 7"],
    hood: [
      "M8 36 Q7 7 24 4 Q41 7 40 36 L32 32 Q24 43 16 32 Z",
      "M17 18 Q24 11 31 18 L30 29 Q24 35 18 29 Z",
    ],
    trail: ["M4 33 Q12 5 23 24 T44 11", "M5 42 Q16 19 25 35 T44 24"],
    spawn: ["M24 4 L29 18 L43 24 L29 30 L24 44 L19 30 L5 24 L19 18 Z"],
    frame: ["M5 5 H43 V43 H5 Z", "M12 12 H36 V36 H12 Z"],
    pose: [
      "M24 18 V32 L13 44 M24 32 L35 44 M24 23 L8 9 M24 23 L40 9",
      "M28 10 A4 4 0 1 0 20 10 A4 4 0 1 0 28 10",
    ],
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths[slot] || paths.bow) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    for (const [key, value] of Object.entries({
      d,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }))
      path.setAttribute(key, value);
    svg.append(path);
  }
  return svg;
}
