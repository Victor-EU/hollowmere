import * as THREE from 'three';

// Geometry for the castle kit. Every piece carries UVs in metres; each texture repeats over its
// own tile size (src/world/assets.ts), so stone courses come out the same size everywhere.

export type Profile = [radius: number, y: number][];

/**
 * A surface of revolution around +y. Each pair of profile points is its own band, so creases
 * between bands stay sharp while each band is smooth around. u wraps a whole number of `tile`s
 * (no seam); v is distance along the profile plus `v0`, so a vertical band's v is its height.
 */
export function lathe(profile: Profile, segments: number, tile: number, v0 = 0, phase = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = v0;
  for (let b = 0; b < profile.length - 1; b++) {
    const [r0, y0] = profile[b];
    const [r1, y1] = profile[b + 1];
    const dr = r1 - r0;
    const dy = y1 - y0;
    const len = Math.hypot(dr, dy);
    if (len < 1e-6) continue;
    const nr = dy / len;
    const ny = -dr / len;
    const rMid = Math.max(Math.abs(r0), Math.abs(r1));
    const wraps = Math.max(1, Math.round((2 * Math.PI * rMid) / tile)) * tile;
    const start = pos.length / 3;
    for (let j = 0; j <= segments; j++) {
      const a = phase + (j / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = -Math.sin(a);
      for (const [r, y, vv] of [
        [r0, y0, v],
        [r1, y1, v + len],
      ]) {
        pos.push(r * c, y, r * s);
        nrm.push(nr * c, ny, nr * s);
        uv.push((j / segments) * wraps, vv);
      }
    }
    for (let j = 0; j < segments; j++) {
      const a = start + j * 2;
      const b2 = a + 2;
      idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
    }
    v += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Segments for a round piece of radius r, so facets stay under about 1.6 m. */
export const segmentsFor = (r: number, min = 12, max = 40) => Math.min(max, Math.max(min, Math.round((2 * Math.PI * r) / 1.6)));

/** A box with metre UVs on every face (upright on the sides), offset by (ou, ov). */
export function box(w: number, h: number, d: number, ou = 0, ov = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] + ou, uv.getY(i) * dims[f][1] + ov);
    }
  }
  return g;
}

/**
 * UVs for extrusions of shapes drawn in a vertical plane (x along, y up, extruded along z):
 * faces are (x, y); side walls run x or y against the depth so courses stay horizontal.
 */
const wallUV = {
  generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number) {
    return [a, b, c].map((i) => new THREE.Vector2(v[i * 3], v[i * 3 + 1]));
  },
  generateSideWallUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number, d: number) {
    const flat = Math.abs(v[a * 3 + 1] - v[b * 3 + 1]) < Math.abs(v[a * 3] - v[b * 3]);
    return [a, b, c, d].map((i) => (flat ? new THREE.Vector2(v[i * 3], v[i * 3 + 2]) : new THREE.Vector2(v[i * 3 + 2], v[i * 3 + 1])));
  },
};

/** Extrude a shape (drawn in x/y, metres) by `depth`, centred on z = 0. */
export function prism(shape: THREE.Shape, depth: number, curveSegments = 8): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments, UVGenerator: wallUV });
  g.translate(0, 0, -depth / 2);
  return withoutSlivers(g);
}

/**
 * Drop zero-area triangles from a non-indexed geometry. The triangulator joins collinear points
 * (hole corners on one line, a pier edge meeting an arch) into slivers whose normals are NaN.
 */
export function withoutSlivers(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const keep: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t);
    b.fromBufferAttribute(pos, t + 1).sub(a);
    c.fromBufferAttribute(pos, t + 2).sub(a);
    if (b.cross(c).lengthSq() > 1e-10) keep.push(t);
  }
  if (keep.length * 3 === pos.count) return g;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const src = g.getAttribute(name);
    const n = src.itemSize;
    const arr = new Float32Array(keep.length * 3 * n);
    keep.forEach((t, i) => {
      for (let v = 0; v < 3; v++) for (let k = 0; k < n; k++) arr[(i * 3 + v) * n + k] = src.array[(t + v) * n + k];
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  g.dispose();
  return out;
}

const SQ3 = Math.sqrt(3) / 2;

/**
 * Points along a pointed (equilateral) arch from the left springing point over the apex to the
 * right one: span `w` centred on `cx`, springing at height `spring`. Each side is an arc of
 * radius `w` centred on the opposite springing point.
 */
export function archPoints(cx: number, spring: number, w: number, n = 8): THREE.Vector2[] {
  const hw = w / 2;
  const out: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * (Math.PI / 3);
    out.push(new THREE.Vector2(cx + hw + Math.cos(a) * w, spring + Math.sin(a) * w));
  }
  for (let i = 1; i <= n; i++) {
    const a = Math.PI / 3 - (i / n) * (Math.PI / 3);
    out.push(new THREE.Vector2(cx - hw + Math.cos(a) * w, spring + Math.sin(a) * w));
  }
  return out;
}

/** A closed lancet outline, `h` tall from its sill to the apex, counter-clockwise. */
export function lancetPath(cx: number, sill: number, w: number, h: number, n = 8): THREE.Vector2[] {
  const spring = sill + h - w * SQ3;
  return [new THREE.Vector2(cx - w / 2, sill), new THREE.Vector2(cx + w / 2, sill), ...archPoints(cx, spring, w, n).reverse()];
}

/** Height of a lancet's apex above its springing line. */
export const archRise = (w: number) => w * SQ3;

export function matrix(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
  return m;
}

/**
 * The two slopes of a pitched roof: ridge along x at height `rise`, the walls' outer faces at
 * z = ±half (y = 0), eaves overhanging by `eave`. `lift` raises the surface along its normal;
 * `inward` faces it down, for a lining seen from inside. UVs run along the ridge and up the slope,
 * so slate courses lie level.
 */
export function roofSlopes(len: number, half: number, rise: number, eave: number, lift = 0, inward = false): THREE.BufferGeometry {
  const alpha = Math.atan2(rise, half);
  const run = half + eave;
  const slant = run / Math.cos(alpha);
  const ye = -eave * Math.tan(alpha);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  for (const s of [1, -1]) {
    const n = new THREE.Vector3(0, Math.cos(alpha), s * Math.sin(alpha));
    const off = n.clone().multiplyScalar(lift);
    const eL = [-len / 2, ye, s * run];
    const eR = [len / 2, ye, s * run];
    const rL = [-len / 2, rise, 0];
    const rR = [len / 2, rise, 0];
    const corners: [number[], number, number][] = [
      [eL, 0, 0],
      [eR, len, 0],
      [rR, len, slant],
      [eL, 0, 0],
      [rR, len, slant],
      [rL, 0, slant],
    ];
    // Wind towards the normal: the south (s = 1) order faces +z; swap two corners for north.
    const flip = (s < 0) !== inward;
    if (flip) {
      [corners[1], corners[2]] = [corners[2], corners[1]];
      [corners[4], corners[5]] = [corners[5], corners[4]];
    }
    const sign = inward ? -1 : 1;
    for (const [p, u, v] of corners) {
      pos.push(p[0] + off.x, p[1] + off.y, p[2] + off.z);
      nrm.push(n.x * sign, n.y * sign, n.z * sign);
      uv.push(u, v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
