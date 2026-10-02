import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldData } from '../data';
import type { Heights } from './heights';
import { fbm, lerp, range, rng, type Rand } from './math';
import type { Materials } from './materials';
import type { Textures } from './textures';

/** A tapered tube from a to b through a bowed middle, as plain triangles. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, bow: THREE.Vector3, segs: number, sides: number): THREE.BufferGeometry {
  const mid = a.clone().lerp(b, 0.5).add(bow);
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const g = new THREE.TubeGeometry(curve, segs, 1, sides, false);
  const p = g.getAttribute('position');
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c);
    const r = lerp(r0, r1, i / segs);
    for (let j = 0; j <= sides; j++) {
      const k = i * (sides + 1) + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.deleteAttribute('uv');
  return g.toNonIndexed();
}

/** A direction tipped `tilt` radians from `dir`, turned `spin` round it. */
function tipped(dir: THREE.Vector3, tilt: number, spin: number): THREE.Vector3 {
  const side = new THREE.Vector3(1, 0, 0);
  if (Math.abs(dir.x) > 0.9) side.set(0, 0, 1);
  side.cross(dir).normalize().applyAxisAngle(dir, spin);
  return dir.clone().applyAxisAngle(side, tilt).normalize();
}

/**
 * One deciduous tree, about 8.5 m tall at scale 1: a trunk that splits into three or four boughs,
 * each forking twice, with leaf clusters at the tips. Each cluster is three crossed cards; each card
 * is doubled back to back so both faces light alike, and its normals point out from the crown, so
 * the whole crown shades like one soft mass rather than a heap of flat planes. A bare tree keeps
 * only its branches.
 */
function deciduous(rand: Rand, bare: boolean): { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry | null } {
  const rr = (a: number, b: number) => range(rand, a, b);
  const wood: THREE.BufferGeometry[] = [];
  const tips: { p: THREE.Vector3; s: number }[] = [];
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const end = start.clone().addScaledVector(dir, len);
    const bow = tipped(dir, Math.PI / 2, rand() * 6.28).multiplyScalar(len * rr(0.04, 0.12));
    wood.push(limb(start, end, r, r * 0.62, bow, depth ? 2 : 3, depth > 1 ? 3 : depth ? 4 : 5));
    if (depth === (bare ? 3 : 2)) {
      tips.push({ p: end, s: rr(1.9, 2.6) });
      return;
    }
    const kids = depth === 0 ? (rand() < 0.5 ? 3 : 4) : 2;
    const spin0 = rand() * 6.28;
    for (let k = 0; k < kids; k++) {
      const tilt = depth === 0 ? rr(0.5, 0.85) : rr(0.35, 0.7);
      const d = tipped(dir, tilt, spin0 + (k / kids) * 6.28 + rr(-0.3, 0.3));
      // Branches arch upward a little.
      d.y += 0.12;
      grow(end, d.normalize(), len * rr(0.62, 0.78), r * 0.62, depth + 1);
    }
    if (depth === 1 && !bare) tips.push({ p: end.clone().addScaledVector(dir, len * 0.1), s: rr(2.2, 2.8) });
  };
  grow(new THREE.Vector3(0, -0.4, 0), tipped(new THREE.Vector3(0, 1, 0), rr(0, 0.12), rand() * 6.28), rr(3.2, 3.9), 0.3, 0);
  if (bare) return { wood: mergeGeometries(wood)!, leaves: null };

  const crown = tips.reduce((c, t) => c.add(t.p), new THREE.Vector3()).divideScalar(tips.length);
  crown.y -= 0.8;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const q = new THREE.Quaternion();
  const corners = [
    [-1, -1, 0, 0],
    [1, -1, 1, 0],
    [1, 1, 1, 1],
    [-1, 1, 0, 1],
  ];
  const n = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (const { p, s } of tips) {
    for (let c = 0; c < 3; c++) {
      q.setFromEuler(new THREE.Euler(rr(-0.6, 0.6), (c / 3) * Math.PI + rr(-0.3, 0.3), rr(-0.4, 0.4)));
      const at = p.clone().add(new THREE.Vector3(rr(-0.4, 0.4), rr(-0.3, 0.3), rr(-0.4, 0.4)));
      // Lower clusters sit in the crown's shade.
      const shade = lerp(0.6, 1, Math.min(1, Math.max(0, (at.y - crown.y + 2) / 5)));
      const quad = corners.map(([x, y, u, w]) => {
        v.set(x * s * 0.5, y * s * 0.5, 0).applyQuaternion(q).add(at);
        n.subVectors(v, crown).normalize();
        return [v.x, v.y, v.z, n.x, n.y, n.z, u, w];
      });
      // Front and back, each wound to face its own way.
      for (const order of [
        [0, 1, 2, 0, 2, 3],
        [0, 2, 1, 0, 3, 2],
      ]) {
        for (const i of order) {
          const [x, y, z, nx, ny, nz, u, w] = quad[i];
          pos.push(x, y, z);
          nor.push(nx, ny, nz);
          uv.push(u, w);
          col.push(shade, shade, shade);
        }
      }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return { wood: mergeGeometries(wood)!, leaves };
}

/**
 * A fir in three drooping tiers, each with a ragged skirt of alternating long and short boughs, on a
 * short trunk. About 9 m tall at scale 1. Shaded lighter at the tips than in the tier's shadow.
 * 44 triangles: there are 2,600 of them, drawn whether in view or not, and again in the lake.
 */
function conifer(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  // [base, radius, top, radius scale]
  const tiers = [
    [0.1, 0.56, 0.58, 1.0],
    [0.34, 0.46, 0.8, 0.82],
    [0.56, 0.34, 1.0, 0.62],
  ];
  const N = 6;
  const tri = (a: number[], b: number[], c: number[], ka: number, kb: number, kc: number) => {
    pos.push(...a, ...b, ...c);
    col.push(ka, ka, ka, kb, kb, kb, kc, kc, kc);
  };
  for (const [base, r, top, rr] of tiers) {
    const apex = [0, top, 0];
    const ring: number[][] = [];
    for (let i = 0; i < N * 2; i++) {
      const a = (i / (N * 2)) * Math.PI * 2;
      const long = i % 2 === 0;
      const rad = r * rr * (long ? 1 : 0.62);
      // Long boughs droop below the tier's base.
      ring.push([Math.cos(a) * rad, base - (long ? 0.05 : -0.03), Math.sin(a) * rad]);
    }
    for (let i = 0; i < N * 2; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % (N * 2)];
      tri(apex, b, a, 1, i % 2 ? 0.75 : 0.9, i % 2 ? 0.9 : 0.75);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.2, 4, 1, true).translate(0, 0.08, 0).toNonIndexed();
  trunk.deleteAttribute('uv');
  trunk.deleteAttribute('normal');
  const dark = new Float32Array(trunk.getAttribute('position').count * 3).fill(0.25);
  trunk.setAttribute('color', new THREE.BufferAttribute(dark, 3));
  const merged = mergeGeometries([g, trunk])!;
  merged.computeVertexNormals();
  return merged;
}

const VARIANTS = 3;

/**
 * About 2,600 instanced firs on the hills, and about 450 autumn trees on the shore, the plateau edge
 * and the outcrop, in three shapes plus a bare one that gathers by the gate. One draw per shape
 * and material.
 */
export function makeTrees(world: WorldData, heights: Heights, M: Materials, tex: Textures, viaductEnd: THREE.Vector3): THREE.Group {
  const rand = rng(3131);
  const rr = (a: number, b: number) => range(rand, a, b);
  const group = new THREE.Group();
  group.name = 'trees';
  const { cliff, outcrop, plateau } = world;
  const d = new THREE.Object3D();
  const c = new THREE.Color();

  // Lambert, like the leaves: needles have no sheen, and grazing specular frosted the tiers.
  const con = new THREE.InstancedMesh(conifer(), new THREE.MeshLambertMaterial({ name: 'conifer', flatShading: true, vertexColors: true }), 2600);
  con.name = 'conifers';
  let n = 0;
  for (let i = 0; i < 9000 && n < 2600; i++) {
    const x = rr(-1100, 1100);
    const z = rr(-1100, 1100);
    const h = heights.terrain(x, z);
    if (h < 2 || h > 170) continue;
    if (Math.hypot(x - cliff.center[0], z - cliff.center[1]) < 114 || Math.hypot(x - outcrop.center[0], z - outcrop.center[1]) < 50) continue;
    const slope = Math.hypot(heights.terrain(x + 4, z) - h, heights.terrain(x, z + 4) - h) / 4;
    if (slope > 0.9) continue;
    if (fbm(x * 0.008, z * 0.008, 3) < -0.12) continue;
    const s = rr(0.8, 1.4);
    d.position.set(x, h - 0.6, z);
    d.scale.set(rr(5.5, 7.5) * s, rr(10, 16) * s, rr(5.5, 7.5) * s);
    d.rotation.set(0, rand() * 6, 0);
    d.updateMatrix();
    con.setMatrixAt(n, d.matrix);
    c.setRGB(rr(0.016, 0.028), rr(0.036, 0.056), rr(0.032, 0.046));
    con.setColorAt(n, c);
    n++;
  }
  con.count = n;
  con.castShadow = true;
  con.receiveShadow = true;
  group.add(con);

  // Autumn trees: muted rust and dull gold, never bright orange (design doc §8).
  const palette = ['#7d3a1e', '#93562a', '#64281b', '#9a7432', '#55301c', '#86452a', '#5d4a26'].map((h) => new THREE.Color(h));
  const shapes = [...Array.from({ length: VARIANTS }, () => deciduous(rand, false)), deciduous(rand, true)];
  const placed: { m: THREE.Matrix4; c: THREE.Color }[][] = shapes.map(() => []);
  const place = (x: number, y: number, z: number, s: number, bareChance = 0.05) => {
    const v = rand() < bareChance ? VARIANTS : Math.floor(rand() * VARIANTS);
    d.position.set(x, y - 0.2, z);
    d.scale.set(s * rr(0.9, 1.1), s * rr(0.85, 1.15), s * rr(0.9, 1.1));
    d.rotation.set(0, rand() * 6.28, 0);
    d.updateMatrix();
    // Brighter than the palette: the leaf texture and the crown's shade darken it about half.
    placed[v].push({ m: d.matrix.clone(), c: palette[Math.floor(rand() * palette.length)].clone().multiplyScalar(rr(1.4, 2)) });
  };
  let m = 0;
  // Shore and hills around the cliff.
  for (let i = 0; i < 6000 && m < 420; i++) {
    const a = rand() * Math.PI * 2;
    const r = rr(108, 340);
    const x = Math.cos(a) * r + (rand() < 0.3 ? outcrop.center[0] * 0.6 : 0);
    const z = Math.sin(a) * r;
    const h = heights.terrain(x, z);
    if (h < 0.8 || h > 45) continue;
    if (Math.hypot(x - outcrop.center[0], z - outcrop.center[1]) < 44) continue;
    place(x, h, z, rr(0.8, 1.3));
    m++;
  }
  // The plateau edge, leaving the hall's lake front clear.
  const { x: hx, z: hz } = world.hall;
  for (let i = 0; i < 70 && m < 520; i++) {
    const a = rand() * Math.PI * 2;
    const r = rr(73, 80);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z > hz[0] - 13 && z < hz[1] + 15 && x > hx[0] - 7 && x < hx[1] + 7) continue;
    place(x, plateau, z, rr(0.6, 0.9));
    m++;
  }
  // The outcrop rim, away from the gate and the viaduct landing. Bare trees gather here.
  for (let i = 0; i < 30 && m < 520; i++) {
    const a = rand() * Math.PI * 2;
    const r = rr(24, 29);
    const x = outcrop.center[0] + Math.cos(a) * r;
    const z = outcrop.center[1] + Math.sin(a) * r;
    if (z > 74 || Math.hypot(x - viaductEnd.x, z - viaductEnd.z) < 12) continue;
    place(x, outcrop.top, z, rr(0.6, 0.85), 0.45);
    m++;
  }

  const leaves = new THREE.MeshLambertMaterial({
    name: 'leaves',
    map: tex.leaves,
    vertexColors: true,
    alphaTest: 0.4,
    // Soft cut-out edges under MSAA.
    alphaToCoverage: true,
  });
  shapes.forEach((shape, v) => {
    const list = placed[v];
    if (!list.length) return;
    const meshes: THREE.InstancedMesh[] = [new THREE.InstancedMesh(shape.wood, M.wood, list.length)];
    meshes[0].name = `tree-wood-${v}`;
    if (shape.leaves) {
      const l = new THREE.InstancedMesh(shape.leaves, leaves, list.length);
      l.name = `tree-leaves-${v}`;
      meshes.push(l);
    }
    for (const im of meshes) {
      list.forEach(({ m, c: col }, i) => {
        im.setMatrixAt(i, m);
        if (im.material !== M.wood) im.setColorAt(i, col);
      });
      im.castShadow = im.receiveShadow = true;
      group.add(im);
    }
  });
  return group;
}
