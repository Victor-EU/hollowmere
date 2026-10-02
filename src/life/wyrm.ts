import * as THREE from 'three';
import type { WorldData } from '../data';
import { clamp, dampK, lerp, range, rng, smoothstep } from '../world/math';
import { WARM_DECAY } from '../world/lights';
import type { Textures } from '../world/textures';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

/** Body length, and the spine bones that are posed along the flight path every frame. */
const LENGTH = 62;
const SPINE = 34;
const STEP = LENGTH / (SPINE - 1);
/** The spine bone the wings grow from, about 13 m behind the head. */
const WING_BONE = Math.round(13 / STEP);
/** The spine never passes closer to the player than this (the doc's floor is 15 m; sway eats some). */
const MIN_PASS = 18;
/** How far round the path, radians either side of the pass, the lean reaches. */
const LEAN_WIDTH = 1.5;

/** Body radius s metres behind the neck: neck, swelling chest, long taper to the tail. */
function radius(s: number): number {
  const i = (s / LENGTH) * 45; // the mockup's 46 segments
  return i < 4 ? 1.3 + 0.15 * i : i < 12 ? lerp(1.9, 2.6, (i - 4) / 8) : lerp(2.6, 0.25, Math.pow((i - 12) / 33, 0.85));
}

type Influence = [bone: number, weight: number];

/** One skinned geometry built from parts: positions, colours, uvs and up to four bone weights each. */
class SkinBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private skin: number[] = [];
  private weight: number[] = [];
  private index: number[] = [];
  private welds: [number, number][] = [];
  private groupStart = 0;
  private groups: [start: number, count: number, material: number][] = [];
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();

  /** Index count so far: marks where a part starts. */
  get indices() {
    return this.index.length;
  }

  vertex(p: THREE.Vector3, c: THREE.Color, bones: Influence[], u = 0, v = 0): number {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    this.uv.push(u, v);
    const top = [...bones].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.skin.push(top[k]?.[0] ?? 0);
      this.weight.push(top[k] ? top[k][1] / sum : 0);
    }
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.index.push(a, b, c);
  }

  /**
   * Quads between consecutive rows of vertex indices. Rows run from the front of a part to its
   * back and each row winds counter-clockwise seen from the front, so faces point outward.
   */
  grid(rows: number[][], closed = false) {
    for (let i = 0; i + 1 < rows.length; i++) {
      const A = rows[i];
      const B = rows[i + 1];
      const n = closed ? A.length : A.length - 1;
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % A.length;
        this.tri(A[j], B[j], A[j1]);
        this.tri(B[j], B[j1], A[j1]);
      }
    }
  }

  /** Close a row's open end with a point, as `grid` would with a collapsed last row. */
  capEnd(row: number[], tip: number, closed = true) {
    const n = closed ? row.length : row.length - 1;
    for (let j = 0; j < n; j++) this.tri(row[j], tip, row[(j + 1) % row.length]);
  }

  /** Two vertices at the same place (a texture seam) that should share one normal. */
  weld(a: number, b: number) {
    this.welds.push([a, b]);
  }

  private at(i: number, out: THREE.Vector3) {
    return out.fromArray(this.pos, i * 3);
  }

  /** Turn every triangle added since `from` to face up (+y), so a flat membrane winds one way. */
  faceUp(from: number) {
    const I = this.index;
    for (let t = from; t < I.length; t += 3) {
      this.at(I[t], this.a);
      this.b.subVectors(this.at(I[t + 1], this.b), this.a);
      this.c.subVectors(this.at(I[t + 2], this.c), this.a);
      if (this.b.cross(this.c).y < 0) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
    }
  }

  /** End the current material group. */
  endGroup(material: number) {
    this.groups.push([this.groupStart, this.index.length - this.groupStart, material]);
    this.groupStart = this.index.length;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.weight, 4));
    g.setIndex(this.index);
    for (const [s, c, m] of this.groups) g.addGroup(s, c, m);
    g.computeVertexNormals();
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    for (const [a, b] of this.welds) {
      this.a.fromBufferAttribute(n, a).add(this.b.fromBufferAttribute(n, b)).normalize();
      n.setXYZ(a, this.a.x, this.a.y, this.a.z);
      n.setXYZ(b, this.a.x, this.a.y, this.a.z);
    }
    return g;
  }
}

/** A tapered tube along a polyline, closed in a point at the end. Its base is left open. */
function tube(b: SkinBuilder, path: THREE.Vector3[], r0: number, r1: number, segs: number, color: THREE.Color, weigh: (p: THREE.Vector3) => Influence[]) {
  const rows: number[][] = [];
  const t = new THREE.Vector3();
  const u = new THREE.Vector3();
  const w = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < path.length - 1; i++) {
    t.subVectors(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]).normalize();
    u.set(0, 1, 0);
    if (Math.abs(t.y) > 0.9) u.set(1, 0, 0);
    // (u, w) turns counter-clockwise seen from the base, as `grid` wants.
    w.crossVectors(u, t).normalize();
    u.crossVectors(t, w);
    const r = lerp(r0, r1, i / (path.length - 1));
    const row: number[] = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      p.copy(path[i]).addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r);
      row.push(b.vertex(p, color, weigh(p)));
    }
    rows.push(row);
  }
  b.grid(rows, true);
  const end = path[path.length - 1];
  b.capEnd(rows[rows.length - 1], b.vertex(end, color, weigh(end)));
}

/** Points along a Catmull-Rom curve through `pts`. */
function curve(pts: THREE.Vector3[], n: number): THREE.Vector3[] {
  return new THREE.CatmullRomCurve3(pts).getPoints(n);
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / Math.max(abx * abx + aby * aby + abz * abz, 1e-9), 0, 1);
  return Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t, p.z - a.z - abz * t);
}

interface WingBones {
  shoulder: THREE.Bone;
  elbow: THREE.Bone;
  wrist: THREE.Bone;
  fingers: THREE.Bone[];
  /** +1 right, -1 left: rotations mirror. */
  side: number;
}

/**
 * The wyrm: an original serpentine dragon, one skinned mesh of about 60 m. Its spine bones are
 * laid along a looping path round the keep every frame, so the body flows through the turns; the
 * jaw is hinged, and the bat-like wings have shoulder, elbow, wrist and four finger bones and flap
 * in a travelling wave. It breathes fire along its path for 2.4 s every 8-13 s: the only big warm
 * event in the sky. A player hovering high near the keep draws the next pass closer (never nearer
 * than 15 m), and the head turns to look for a moment.
 */
export function makeWyrm(world: WorldData, tex: Textures, ctx: LifeContext): Living {
  const rand = rng(6060);
  const cfg = world.life.wyrm;
  const [cx, cy, cz] = cfg.center;
  const group = new THREE.Group();
  group.name = 'wyrm';

  // Bones. The spine is flat (each posed in world space); the jaw and wings hang off it.
  const spine = Array.from({ length: SPINE }, (_, i) => {
    const bone = new THREE.Bone();
    bone.name = `spine-${i}`;
    bone.position.set(0, 0, -i * STEP);
    return bone;
  });
  const bones: THREE.Bone[] = [...spine];
  const boneIndex = (bone: THREE.Bone) => bones.indexOf(bone);
  const jaw = new THREE.Bone();
  jaw.name = 'jaw';
  const HINGE = new THREE.Vector3(0, -0.42, 0.55);
  jaw.position.copy(HINGE);
  spine[0].add(jaw);
  bones.push(jaw);
  const JAW = boneIndex(jaw);
  const spineAt = (s: number): Influence[] => {
    const f = clamp(s / STEP, 0, SPINE - 1);
    const b0 = Math.min(SPINE - 2, Math.floor(f));
    return [
      [b0, 1 - (f - b0)],
      [b0 + 1, f - b0],
    ];
  };

  const b = new SkinBuilder();
  const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
  const WHITE = new THREE.Color(1, 1, 1);
  const BELLY = new THREE.Color(1.55, 1.2, 0.95);
  const MOUTH = C('#5a160a', 3);
  const p = new THREE.Vector3();
  const col = new THREE.Color();

  // Body: an elliptical tube from the neck to the tail tip, two spine bones per ring. The scale
  // texture's v runs in body widths, so scales shrink with the body toward the tail.
  {
    const AROUND = 16;
    const RINGS = 72;
    const rows: number[][] = [];
    let v = 0;
    for (let k = 0; k <= RINGS; k++) {
      const s = (k / RINGS) * LENGTH;
      const r = radius(s);
      if (k) v += LENGTH / RINGS / ((Math.PI * 2 * r) / 4);
      const row: number[] = [];
      for (let j = 0; j <= AROUND; j++) {
        const a = (j / AROUND) * Math.PI * 2;
        const sn = Math.sin(a);
        // A low ridge along the back, a flatter belly.
        const y = sn > 0 ? sn * 0.95 * (1 + 0.06 * Math.pow(sn, 8)) : sn * 0.78;
        p.set(Math.cos(a) * r, y * r, -s);
        col.copy(WHITE).lerp(BELLY, smoothstep(-0.2, -0.8, sn));
        row.push(b.vertex(p, col, spineAt(s), (j / AROUND) * 4, v));
      }
      b.weld(row[0], row[AROUND]);
      rows.push(row);
    }
    b.grid(rows);
    b.capEnd(rows[rows.length - 1], b.vertex(p.set(0, 0, -LENGTH - 0.9), WHITE, spineAt(LENGTH), 0, v), false);
  }

  // Head, in the first spine bone's frame: a loft from the snout tip back over the brow, with a
  // flat palate underneath for the jaw to close against.
  const HEAD: [z: number, w: number, h: number, c: number][] = [
    [6.25, 0.3, 0.26, -0.02],
    [5.7, 0.62, 0.46, 0],
    [4.8, 0.82, 0.6, 0.02],
    [3.4, 1.0, 0.78, 0.08],
    [2.1, 1.35, 1.05, 0.2],
    [1.2, 1.7, 1.45, 0.35],
    [0.3, 1.6, 1.5, 0.3],
    [-0.6, 1.25, 1.2, 0.1],
  ];
  const headAt = (z: number) => {
    let i = 0;
    while (i < HEAD.length - 2 && HEAD[i + 1][0] > z) i++;
    const [z0, w0, h0, c0] = HEAD[i];
    const [z1, w1, h1, c1] = HEAD[i + 1];
    const t = clamp((z - z0) / (z1 - z0), 0, 1);
    return { w: lerp(w0, w1, t), h: lerp(h0, h1, t), c: lerp(c0, c1, t) };
  };
  const HEAD_BONE: Influence[] = [[0, 1]];
  {
    const AROUND = 18;
    const rows: number[][] = [];
    for (const [z, w, h, c] of HEAD) {
      const row: number[] = [];
      for (let j = 0; j <= AROUND; j++) {
        const a = (j / AROUND) * Math.PI * 2;
        const sn = Math.sin(a);
        // Brow ridges over the eyes.
        const brow = 1 + 0.14 * Math.exp(-((Math.abs(a - Math.PI / 2) - 0.75) ** 2) / 0.05) * smoothstep(2.6, 1.4, z) * smoothstep(-0.2, 0.8, z);
        p.set(Math.cos(a) * w * brow, c + (sn > 0 ? sn * h * brow : sn * h * 0.45), z);
        col.copy(WHITE).lerp(MOUTH, smoothstep(-0.75, -0.97, sn));
        row.push(b.vertex(p, col, HEAD_BONE, (j / AROUND) * 4, z / 0.9));
      }
      b.weld(row[0], row[AROUND]);
      rows.push(row);
    }
    // The snout tip first, so the row order runs front to back like the body's.
    const tip = b.vertex(p.set(0, -0.02, 6.5), WHITE, HEAD_BONE);
    for (let j = 0; j < AROUND; j++) b.tri(rows[0][j], rows[0][j + 1], tip);
    b.grid(rows);
  }

  // Jaw, hinged under the skull: a half-round underside with a flat mouth floor on top.
  const JAW_SECTIONS: [z: number, w: number, d: number][] = [
    [5.55, 0.18, 0.13],
    [5.2, 0.42, 0.25],
    [4.1, 0.7, 0.38],
    [2.5, 0.92, 0.5],
    [0.9, 1.22, 0.64],
    [-0.35, 1.2, 0.72],
  ];
  const jawAt = (z: number) => {
    let i = 0;
    while (i < JAW_SECTIONS.length - 2 && JAW_SECTIONS[i + 1][0] > z) i++;
    const [z0, w0] = JAW_SECTIONS[i];
    const [z1, w1] = JAW_SECTIONS[i + 1];
    return lerp(w0, w1, clamp((z - z0) / (z1 - z0), 0, 1));
  };
  const JAW_BONE: Influence[] = [[JAW, 1]];
  {
    const rows: number[][] = [];
    for (const [z, w, d] of JAW_SECTIONS) {
      const row: number[] = [];
      // Counter-clockwise seen from the front: under the chin from left to right, then back
      // across the mouth floor.
      for (let j = 0; j <= 8; j++) {
        const a = Math.PI + (j / 8) * Math.PI;
        p.set(Math.cos(a) * w, Math.sin(a) * d, z).add(HINGE);
        row.push(b.vertex(p, WHITE, JAW_BONE, (j / 8) * 2, z / 0.9));
      }
      for (let j = 1; j < 4; j++) {
        p.set(w * (1 - (j / 4) * 2), 0.02, z).add(HINGE);
        row.push(b.vertex(p, MOUTH, JAW_BONE));
      }
      rows.push(row);
    }
    const tip = b.vertex(p.set(0, -0.06, 5.75).add(HINGE), WHITE, JAW_BONE);
    for (let j = 0; j < rows[0].length; j++) b.tri(rows[0][j], rows[0][(j + 1) % rows[0].length], tip);
    b.grid(rows, true);
  }
  b.endGroup(0);

  // Everything else is untextured and coloured per vertex: horns, teeth, spikes, wings.
  const HORN = C('#2c2925');
  const TOOTH = C('#c9bfae');
  const IRON = C('#1d1c20');
  const SKIN = C('#3d1d14');
  const RIB = C('#1e1612');

  // Two long horns swept back from the brow, and a shorter pair from the cheeks.
  for (const sx of [-1, 1]) {
    tube(b, curve([new THREE.Vector3(sx * 0.8, 1.35, 0.6), new THREE.Vector3(sx * 1.05, 2.0, -0.8), new THREE.Vector3(sx * 1.25, 2.55, -2.4), new THREE.Vector3(sx * 1.05, 2.85, -3.9)], 10), 0.36, 0.03, 6, HORN, () => HEAD_BONE);
    tube(b, curve([new THREE.Vector3(sx * 1.35, 0.35, 0.4), new THREE.Vector3(sx * 1.75, 0.3, -0.9), new THREE.Vector3(sx * 2.0, 0.45, -2.1)], 6), 0.2, 0.02, 5, HORN, () => HEAD_BONE);
  }
  // Teeth along both jaws, interleaved.
  for (let z = 2.3; z < 5.9; z += 0.55) {
    const { w, h, c } = headAt(z);
    for (const sx of [-1, 1]) {
      const base = new THREE.Vector3(sx * w * 0.8, c - h * 0.3, z);
      tube(b, [base, base.clone().add(new THREE.Vector3(0, -0.45, 0.05))], 0.08, 0.01, 4, TOOTH, () => HEAD_BONE);
      const zj = z + 0.27 - HINGE.z;
      if (zj > 5.3) continue;
      const lb = new THREE.Vector3(sx * jawAt(zj) * 0.82, 0, zj).add(HINGE);
      tube(b, [lb, lb.clone().add(new THREE.Vector3(0, 0.38, 0.04))], 0.07, 0.01, 4, TOOTH, () => JAW_BONE);
    }
  }
  // Back spikes, tilted toward the tail.
  for (let s = 0.8; s < 46; s += 1.55) {
    const r = radius(s);
    const hgt = clamp(r * 0.75, 0.35, 1.7);
    const base = new THREE.Vector3(0, r - 0.15, -s);
    tube(b, [base, base.clone().add(new THREE.Vector3(0, hgt, -hgt * 0.55))], clamp(r * 0.16, 0.08, 0.4), 0.01, 4, IRON, () => spineAt(s));
  }

  // Wings. Built for the right side in the shoulder's frame (x outward, z forward), mirrored for
  // the left. Membrane and finger vertices take the nearest bones by distance.
  const wings: WingBones[] = [];
  {
    const sw = WING_BONE * STEP;
    const rw = radius(sw);
    const S = new THREE.Vector3(0, 0, 0);
    const E = new THREE.Vector3(5.5, 0.5, 1.4);
    const W = new THREE.Vector3(10.5, 0.7, 2.4);
    const F = [new THREE.Vector3(20, 0.2, -0.4), new THREE.Vector3(16, 0, -4.4), new THREE.Vector3(11, 0, -6.6), new THREE.Vector3(5.4, 0, -6.8)];
    const R = new THREE.Vector3(0, 0, -4.6);
    for (const sx of [1, -1]) {
      const root = new THREE.Vector3(sx * rw * 0.62, rw * 0.7, -sw);
      const shoulder = new THREE.Bone();
      shoulder.position.set(sx * rw * 0.62, rw * 0.7, 0);
      spine[WING_BONE].add(shoulder);
      const elbow = new THREE.Bone();
      elbow.position.set(sx * E.x, E.y, E.z);
      shoulder.add(elbow);
      const wrist = new THREE.Bone();
      wrist.position.set(sx * (W.x - E.x), W.y - E.y, W.z - E.z);
      elbow.add(wrist);
      const fingers = F.map(() => {
        const f = new THREE.Bone();
        wrist.add(f);
        return f;
      });
      bones.push(shoulder, elbow, wrist, ...fingers);
      shoulder.name = `wing-${sx > 0 ? 'right' : 'left'}`;
      wings.push({ shoulder, elbow, wrist, fingers, side: sx });

      // Wing-local to mesh space, and the bone segments that weigh each vertex.
      const m = (v: THREE.Vector3) => new THREE.Vector3(sx * v.x, v.y, v.z).add(root);
      const segs: [THREE.Vector3, THREE.Vector3, number][] = [
        [m(S), m(E), boneIndex(shoulder)],
        [m(E), m(W), boneIndex(elbow)],
        ...F.map((f, i): [THREE.Vector3, THREE.Vector3, number] => [m(W), m(f), boneIndex(fingers[i])]),
        // Where the membrane meets the body, it follows the spine.
        [m(S), m(new THREE.Vector3(0, 0, -STEP)), WING_BONE],
        [m(new THREE.Vector3(0, 0, -STEP)), m(new THREE.Vector3(0, 0, -2 * STEP)), WING_BONE + 1],
        [m(new THREE.Vector3(0, 0, -2 * STEP)), m(new THREE.Vector3(0, 0, -3 * STEP)), WING_BONE + 2],
      ];
      const weigh = (q: THREE.Vector3): Influence[] => segs.map(([a, c, bone]) => [bone, 1 / (distToSegment(q, a, c) + 0.25) ** 4]);
      const nearBone = (q: THREE.Vector3) => Math.min(...segs.slice(0, 6).map(([a, c]) => distToSegment(q, a, c)));
      const membrane = (q: THREE.Vector3) => {
        const mq = m(q);
        // Darker ribs where the membrane runs along a bone.
        return b.vertex(mq, col.copy(SKIN).lerp(RIB, 1 - smoothstep(0.1, 0.9, nearBone(mq))), weigh(mq));
      };
      const from = b.indices;
      // The arm panel: from the arm (shoulder, elbow, wrist) back to the body and the last finger.
      const arm = (u: number) => (u < 0.5 ? S.clone().lerp(E, u * 2) : E.clone().lerp(W, u * 2 - 1));
      const scallop = (a: THREE.Vector3, c: THREE.Vector3, toward: THREE.Vector3, u: number, depth: number) => {
        const q = a.clone().lerp(c, u);
        return q.lerp(toward, depth * Math.sin(Math.PI * u));
      };
      {
        const rows: number[][] = [];
        for (let i = 0; i <= 10; i++) {
          const u = i / 10;
          const A = arm(u);
          const T = scallop(R, F[3], A, u, 0.2);
          const row: number[] = [];
          for (let j = 0; j <= 5; j++) row.push(membrane(A.clone().lerp(T, j / 5)));
          rows.push(row);
        }
        b.grid(rows);
      }
      // A narrow leading membrane in front of the arm.
      {
        const rows: number[][] = [];
        for (let i = 0; i <= 10; i++) {
          const u = i / 10;
          const A = arm(u);
          // Never quite zero wide at the ends, or the end triangles have no area.
          const L = A.clone().add(new THREE.Vector3(0, 0, 0.9 * Math.max(0.06, Math.pow(Math.sin(Math.PI * u), 0.7))));
          rows.push([membrane(A), membrane(L)]);
        }
        b.grid(rows);
      }
      // Fans between the fingers, from the wrist out to a scalloped trailing edge.
      for (let k = 0; k < 3; k++) {
        const ring: number[][] = [];
        for (let j = 1; j <= 5; j++) {
          const row: number[] = [];
          for (let i = 0; i <= 8; i++) row.push(membrane(W.clone().lerp(scallop(F[k], F[k + 1], W, i / 8, 0.22), j / 5)));
          ring.push(row);
        }
        const hub = membrane(W);
        for (let i = 0; i < 8; i++) b.tri(hub, ring[0][i], ring[0][i + 1]);
        b.grid(ring);
      }
      b.faceUp(from);
      // The bones themselves, as thin tubes, and a hooked thumb claw at the wrist.
      tube(b, [m(S), m(E), m(W)], 0.34, 0.18, 6, RIB, weigh);
      for (const f of F) tube(b, [m(W), m(W.clone().lerp(f, 0.5)), m(f)], 0.16, 0.03, 5, RIB, weigh);
      tube(b, curve([m(W), m(W.clone().add(new THREE.Vector3(0.1, 0.25, 0.7))), m(W.clone().add(new THREE.Vector3(0.05, -0.05, 1.2)))], 4), 0.14, 0.01, 4, HORN, () => [[boneIndex(wrist), 1]]);
    }
  }
  // A spade at the tail tip, membrane like the wings.
  {
    const from = b.indices;
    const last: Influence[] = [[SPINE - 1, 1]];
    const tail = [new THREE.Vector3(0, 0, -LENGTH + 1.6), new THREE.Vector3(1.4, 0, -LENGTH + 0.1), new THREE.Vector3(0, 0, -LENGTH - 2.4), new THREE.Vector3(-1.4, 0, -LENGTH + 0.1)].map((q) =>
      b.vertex(q, SKIN, last),
    );
    b.tri(tail[0], tail[1], tail[2]);
    b.tri(tail[0], tail[2], tail[3]);
    b.faceUp(from);
  }
  b.endGroup(1);

  const hide = new THREE.MeshStandardMaterial({
    name: 'wyrm',
    map: tex.scales.albedo,
    emissiveMap: tex.scales.ember,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 0.7,
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.15,
  });
  // Lambert: thin spikes and edge-on membranes caught grazing specular and read as pale streaks.
  const leather = new THREE.MeshLambertMaterial({
    name: 'wyrm-wing',
    vertexColors: true,
    emissive: new THREE.Color('#180503'),
    side: THREE.DoubleSide,
  });
  const body = new THREE.SkinnedMesh(b.build(), [hide, leather]);
  body.name = 'wyrm-body';
  body.frustumCulled = false;
  for (const bone of spine) body.add(bone);
  body.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(bones));
  group.add(body);

  // Eyes ride the head bone.
  const eyeGeo = new THREE.SphereGeometry(0.24, 10, 8);
  const eyes = new THREE.Group();
  const eyeMat = new THREE.MeshBasicMaterial({ name: 'wyrm-eye', color: new THREE.Color(3, 1.75, 0.3), fog: false });
  {
    const { w, h, c } = headAt(1.5);
    // Low on the side of the head, under the brow ridge.
    const a = 0.45;
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.position.set(sx * Math.cos(a) * w * 1.04, c + Math.sin(a) * h * 0.97, 1.5);
      eyes.add(e);
    }
  }
  spine[0].add(eyes);

  const fire = new Pool(420);
  group.add(fire.points);
  // Peak 5 over 150 m in the mockup's legacy units, converted as in world/lights.ts.
  const FIRE_PEAK = 352;
  const fireLight = new THREE.PointLight(new THREE.Color('#ff6a1a'), 0, 150, WARM_DECAY);
  group.add(fireLight);

  const path = (th: number, out: THREE.Vector3) => {
    const R = cfg.radius + 9 * Math.sin(2 * th + 0.6);
    return out.set(cx + R * Math.cos(th), cy + 9 * Math.sin(1.5 * th) + 4 * Math.sin(3.7 * th), cz + R * Math.sin(th));
  };

  let theta = 2.2;
  let breath = 0;
  let nextBreath = 6;
  let roared = false;
  // Flapping comes in bouts between glides.
  let flapPhase = 0;
  let flapAmp = 0.5;
  let flapping = true;
  let bout = 5;
  // Reaction to a player hovering high near the keep.
  let interest = 0;
  let thC = 0;
  const lean = new THREE.Vector3();
  let track = 0;
  let tracked = 0;

  const ths = new Float32Array(SPINE);
  const pts = Array.from({ length: SPINE }, () => new THREE.Vector3());
  const tans = Array.from({ length: SPINE }, () => new THREE.Vector3());
  const UP = new THREE.Vector3(0, 1, 0);
  const tA = new THREE.Vector3();
  const tB = new THREE.Vector3();
  const tC = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const qLook = new THREE.Quaternion();
  const qPath = new THREE.Quaternion();
  const wrap = (a: number) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

  return {
    object: group,
    update(dt, time) {
      const P = ctx.player;
      theta += dt * 0.15;

      // Interest: above about 130 m near the keep, the next pass leans up to 20 m toward the
      // player. Interested or not, the pass stays MIN_PASS away, preferring to go over or under
      // rather than beside, where the 20 m wings would sweep through the player.
      const keepDist = Math.hypot(P.x - cx, P.z - cz);
      const high = P.y > 130 && keepDist < cfg.radius + 70;
      interest = lerp(interest, high ? 1 : 0, dampK(high ? 0.5 : 0.25, dt));
      let thP = theta + wrap(Math.atan2(P.z - cz, P.x - cx) - theta);
      let d = Infinity;
      for (let k = -6; k <= 6; k++) {
        const dk = path(thP + k * 0.11, tA).distanceTo(P);
        if (dk < d) {
          d = dk;
          thC = thP + k * 0.11;
        }
      }
      thP = thC;
      const pass = path(thP, tA);
      const away = tB.subVectors(pass, P).divideScalar(Math.max(d, 1e-3));
      const want = d > MIN_PASS ? lerp(d, Math.max(MIN_PASS, d - 20), interest) : MIN_PASS;
      away.lerp(tC.set(0, away.y >= 0 ? 1 : -1, 0), 0.6 * Math.max(interest, d < MIN_PASS + 10 ? 1 : 0)).normalize();
      // Where the pass should be, relative to where the path would put it.
      tC.copy(P).addScaledVector(away, want).sub(pass);
      lean.lerp(tC, dampK(3, dt));

      // Spine along the path, one bone every STEP metres of arc behind the head.
      ths[0] = theta;
      for (let i = 1; i < SPINE; i++) {
        const th = ths[i - 1];
        const speed = path(th + 0.001, tA).distanceTo(path(th, tB)) / 0.001;
        ths[i] = th - STEP / speed;
      }
      for (let i = 0; i < SPINE; i++) {
        const q = path(ths[i], pts[i]);
        const dl = wrap(ths[i] - thP);
        const win = Math.abs(dl) < LEAN_WIDTH ? Math.cos((dl / LEAN_WIDTH) * (Math.PI / 2)) ** 2 : 0;
        q.addScaledVector(lean, win);
      }
      for (let i = 0; i < SPINE; i++) {
        tans[i].subVectors(pts[Math.max(0, i - 1)], pts[Math.min(SPINE - 1, i + 1)]).normalize();
      }
      // A travelling wave down the body, growing toward the tail.
      for (let i = 0; i < SPINE; i++) {
        const k = i / SPINE;
        side.crossVectors(UP, tans[i]).normalize();
        pts[i].addScaledVector(side, Math.sin(i * 0.355 - time * 2.6) * 1.3 * k);
        pts[i].y += Math.sin(i * 0.27 - time * 2.0) * 0.8 * k;
      }
      for (let i = 0; i < SPINE; i++) {
        tans[i].subVectors(pts[Math.max(0, i - 1)], pts[Math.min(SPINE - 1, i + 1)]).normalize();
      }
      for (let i = 0; i < SPINE; i++) {
        const t = tans[i];
        // Bank into turns: lift tilts toward the inside of the curve.
        tC.subVectors(tans[Math.max(0, i - 1)], tans[Math.min(SPINE - 1, i + 1)]).multiplyScalar(14 / (2 * STEP)).clampLength(0, 0.5);
        up.copy(UP).add(tC).normalize();
        side.crossVectors(up, t).normalize();
        up.crossVectors(t, side);
        basis.makeBasis(side, up, t);
        const bone = spine[i];
        bone.position.copy(pts[i]);
        bone.quaternion.setFromRotationMatrix(basis);
      }

      // The head looks at a high player for a moment as it passes. It never breathes fire then.
      const head = spine[0];
      qPath.copy(head.quaternion);
      const toP = tA.subVectors(P, head.position);
      const dist = toP.length();
      toP.normalize();
      if (dist > 110) tracked = 0;
      const wantTrack = interest > 0.5 && dist < 80 && toP.dot(tans[0]) > -0.1 && tracked < 4 && breath <= 0;
      track = lerp(track, wantTrack ? 1 : 0, dampK(wantTrack ? 2 : 1.2, dt));
      if (track > 0.5) tracked += dt;
      if (track > 0.01) {
        side.crossVectors(UP, toP).normalize();
        up.crossVectors(toP, side);
        qLook.setFromRotationMatrix(basis.makeBasis(side, up, toP));
        head.quaternion.slerp(qLook, track * 0.7);
      }

      // Wings: bouts of flapping between glides, the beat travelling out to the fingertips.
      bout -= dt;
      if (bout <= 0) {
        flapping = !flapping;
        bout = flapping ? range(rand, 6, 11) : range(rand, 4, 8);
      }
      // Near the player it glides with shallow strokes, so a wing tip never sweeps through.
      const close = spine[WING_BONE].position.distanceTo(P) < 45;
      flapAmp = lerp(flapAmp, flapping ? (close ? 0.25 : 0.55) : 0.1, dampK(0.8, dt));
      const prev = flapPhase;
      flapPhase += dt * (flapping ? 2.4 : 1.2);
      const A = flapAmp;
      const ph = flapPhase;
      for (const w of wings) {
        const s = w.side;
        w.shoulder.rotation.set(0, s * 0.12 * A * Math.cos(ph), s * (0.1 + A * Math.sin(ph)));
        w.elbow.rotation.set(0, 0, s * 0.4 * A * Math.sin(ph - 0.7));
        // The hand folds back a little on the upstroke.
        const fold = 0.16 * A * (1 + Math.sin(ph - 1.2 + Math.PI / 2));
        w.wrist.rotation.set(0, s * fold, s * 0.3 * A * Math.sin(ph - 1.2));
        w.fingers.forEach((f, k) => f.rotation.set(0, -s * fold * 0.25 * k, s * (0.25 * A * Math.sin(ph - 1.6) - 0.02 * k)));
      }
      // A wing beat at the top of each stroke, when it passes within 40 m.
      if (A > 0.2 && Math.floor((prev - Math.PI / 2) / (Math.PI * 2)) !== Math.floor((ph - Math.PI / 2) / (Math.PI * 2))) {
        const root = spine[WING_BONE].position;
        if (root.distanceTo(P) < 40) ctx.sound('wingbeat', root);
      }

      // Fire, always aimed along the path, never at the player.
      nextBreath -= dt;
      if (nextBreath <= 0 && breath <= 0 && track < 0.1) {
        breath = 2.4;
        nextBreath = range(rand, 8, 13);
        roared = false;
      }
      let open = track > 0.3 ? 0.22 : 0.06;
      if (breath > 0) {
        breath -= dt;
        open = 0.55;
        if (!roared) {
          roared = true;
          ctx.sound('roar', head.position);
        }
        const mouth = tB.set(0, -0.35, 6.6).applyQuaternion(qPath).add(head.position);
        const fwd = tC.set(0, -0.12, 1).normalize().applyQuaternion(qPath);
        const n = Math.floor(dt * 180 + Math.random());
        for (let k = 0; k < n; k++) {
          fire.emit(mouth.x, mouth.y, mouth.z, fwd.x * 30 + (Math.random() - 0.5) * 7, fwd.y * 30 + (Math.random() - 0.5) * 7 - 2, fwd.z * 30 + (Math.random() - 0.5) * 7, 1.0 + Math.random() * 0.6);
        }
        fireLight.position.copy(mouth).addScaledVector(fwd, 8);
        // ~2 Hz flicker: the design doc caps flashing at 3 Hz (the mockup ran at 6 Hz).
        fireLight.intensity = lerp(fireLight.intensity, FIRE_PEAK * (1 + Math.sin(time * 13) * 0.24), dampK(10, dt));
      } else fireLight.intensity = lerp(fireLight.intensity, 0, dampK(4, dt));
      jaw.rotation.x = lerp(jaw.rotation.x, open, dampK(8, dt));
      // The embers between the scales flare while it breathes.
      hide.emissiveIntensity = lerp(hide.emissiveIntensity, breath > 0 ? 1.6 : 0.7, dampK(3, dt));
      fire.update(dt, 1.3, (i, t, pl) => {
        const fade = 1 - smoothstep(0.55, 1, t);
        let r: number;
        let g: number;
        let bl: number;
        if (t < 0.15) {
          r = 4;
          g = 3;
          bl = 1.4;
        } else if (t < 0.5) {
          const k = (t - 0.15) / 0.35;
          r = lerp(4, 3, k);
          g = lerp(3, 0.9, k);
          bl = lerp(1.4, 0.15, k);
        } else {
          const k = (t - 0.5) / 0.5;
          r = lerp(3, 0.5, k);
          g = lerp(0.9, 0.1, k);
          bl = lerp(0.15, 0.03, k);
        }
        pl.col.set([r * fade, g * fade, bl * fade, fade], i * 4);
        pl.size[i] = lerp(1.6, 9, Math.sqrt(t));
        pl.vel[i * 3 + 1] += 3 * dt;
      });
    },
  };
}
