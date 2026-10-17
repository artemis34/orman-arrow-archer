/** Uniform grid broad phase. Query visits only intersecting cells. */
export class SpatialGrid {
  constructor(cell = 6) {
    this.cell = cell;
    this.cells = new Map();
  }
  clear() {
    this.cells.clear();
  }
  key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }
  insert(object, r = 0) {
    for (
      let x = Math.floor((object.x - r) / this.cell);
      x <= Math.floor((object.x + r) / this.cell);
      x++
    )
      for (
        let z = Math.floor((object.z - r) / this.cell);
        z <= Math.floor((object.z + r) / this.cell);
        z++
      ) {
        const k = `${x},${z}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(object);
      }
  }
  query(x, z, r) {
    const result = new Set();
    for (
      let a = Math.floor((x - r) / this.cell);
      a <= Math.floor((x + r) / this.cell);
      a++
    )
      for (
        let b = Math.floor((z - r) / this.cell);
        b <= Math.floor((z + r) / this.cell);
        b++
      )
        for (const o of this.cells.get(`${a},${b}`) || []) result.add(o);
    return result;
  }
}
/** Swept segment-circle intersection prevents tunnelling by fast arrows. */
export function segmentFraction(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax,
    dz = bz - az,
    fx = ax - cx,
    fz = az - cz,
    a = dx * dx + dz * dz,
    c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fz * dz),
    disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
export function segmentHit(...args) {
  return segmentFraction(...args) !== null;
}
export class Pool {
  constructor(create, max) {
    this.free = Array.from({ length: max }, create);
    this.active = [];
  }
  acquire() {
    const o = this.free.pop();
    if (o) this.active.push(o);
    return o;
  }
  release(index) {
    const o = this.active[index];
    this.active[index] = this.active[this.active.length - 1];
    this.active.pop();
    this.free.push(o);
  }
}
