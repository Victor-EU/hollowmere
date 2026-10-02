import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Creatures built from simple parts (ellipsoids, tapered limbs, cones), each part hanging from a
// joint, posed in the vertex shader. A kind of creature is one geometry and one InstancedMesh, so
// a herd, a pack or a hall full of guests is one draw, every member in its own pose.
//
// Model space: the creature faces +z, up is +y, x is its left-right. Each vertex carries its joint
// and that joint's pivot; each instance carries the joint angles in three vec4s:
//
//   iA  head pitch, head yaw, tail pitch, tail yaw
//   iB  front-left, front-right, back-left, back-right limb pitch (arms for the hall's guests;
//       the first two also roll the wings of a bird)
//   iC  hand-prop scale (a goblet), glow, wing scale, head-prop scale (antlers, a crown)
//
// Positive pitch turns +z down: the head lowers to graze, a leg swings back. Glow is emissive, in
// the vertex colour, scaled per instance: eyes, a pumpkin's carved face.

export const J = {
  body: 0,
  head: 1,
  tail: 2,
  fl: 3,
  fr: 4,
  bl: 5,
  br: 6,
  wingL: 7,
  wingR: 8,
  /** On the head, scaled by the head-prop channel: antlers, a crown. */
  headProp: 9,
  /** In the right hand (front-right limb), scaled by the hand-prop channel: a goblet. */
  handProp: 10,
  /** In the left hand, likewise. */
  handPropL: 11,
} as const;

const GLSL = /* glsl */ `
  attribute float aJoint;
  attribute vec3 aPivot;
  attribute float aGlow;
  attribute vec4 iA;
  attribute vec4 iB;
  attribute vec4 iC;
  varying float vGlow;
  mat3 rigR;
  vec3 rigP;
  float rigS;
  mat3 rigX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rigY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rigZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
  void rigPose() {
    int j = int(aJoint + 0.5);
    rigR = mat3(1.0);
    rigP = aPivot;
    rigS = 1.0;
    if (j == 1 || j == 9) rigR = rigY(iA.y) * rigX(iA.x);
    else if (j == 2) rigR = rigY(iA.w) * rigX(iA.z);
    else if (j == 3 || j == 11) rigR = rigX(iB.x);
    else if (j == 4 || j == 10) rigR = rigX(iB.y);
    else if (j == 5) rigR = rigX(iB.z);
    else if (j == 6) rigR = rigX(iB.w);
    else if (j == 7) rigR = rigZ(iB.x);
    else if (j == 8) rigR = rigZ(-iB.y);
    if (j == 9) rigS = iC.w;
    else if (j == 10 || j == 11) rigS = iC.x;
    else if (j == 7 || j == 8) rigS = iC.z;
  }
`;

/** Lambert with vertex colours, posed by the rig. One shader program for every creature. */
export function rigMaterial(name: string, params: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ name, vertexColors: true, ...params });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <beginnormal_vertex>', 'rigPose();\nvec3 objectNormal = rigR * normal;')
      .replace('#include <begin_vertex>', 'vec3 transformed = rigP + rigR * ((position - rigP) * rigS);')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGlow = aGlow * iC.y;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow;');
  };
  m.customProgramCacheKey = () => 'hollowmere-rig';
  return m;
}

type V3 = readonly [number, number, number];
type Paint = THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.ColorRepresentation);
const v = (p: V3) => new THREE.Vector3(...p);

/** An ellipsoid at `c` with radii `r`, turned by `tilt`: a pitch about x, or an [x, y, z] Euler. */
export function ellipsoid(c: V3, r: V3, tilt: number | V3 = 0, seg = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.7)));
  g.scale(...r);
  if (typeof tilt === 'number') {
    if (tilt) g.rotateX(tilt);
  } else g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...tilt, 'YXZ')));
  return g.translate(...c);
}

/** A tapered limb from `a` (radius ra) to `b` (radius rb), capped. */
export function limb(a: V3, b: V3, ra: number, rb: number, seg = 6): THREE.BufferGeometry {
  const A = v(a);
  const B = v(b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  return g.translate(A.x, A.y, A.z);
}

/** Limbs through a run of points, with a ball at each bend so the joins stay round. */
export function chain(points: V3[], radii: number[], seg = 6): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    out.push(limb(points[i], points[i + 1], radii[i], radii[i + 1], seg));
    if (i > 0) out.push(ellipsoid(points[i], [radii[i], radii[i], radii[i]], 0, seg));
  }
  return out;
}

/** A cone from a base centre to a tip. */
export function cone(base: V3, tip: V3, r: number, seg = 6): THREE.BufferGeometry {
  return limb(base, tip, r, 0.0001, seg);
}

interface Part {
  g: THREE.BufferGeometry;
  joint: number;
  pivot: V3;
  paint: Paint;
  glow: number;
}

/** Collects parts, then merges them into one geometry with the rig's attributes. */
export class Rig {
  private parts: Part[] = [];

  add(g: THREE.BufferGeometry | THREE.BufferGeometry[], joint: number, pivot: V3, paint: Paint, glow = 0): this {
    for (const one of Array.isArray(g) ? g : [g]) this.parts.push({ g: one, joint, pivot, paint, glow });
    return this;
  }

  build(): THREE.BufferGeometry {
    const c = new THREE.Color();
    const p = new THREE.Vector3();
    const done = this.parts.map(({ g, joint, pivot, paint, glow }) => {
      const geo = g.index ? g.toNonIndexed() : g;
      geo.deleteAttribute('uv');
      const pos = geo.getAttribute('position');
      const n = pos.count;
      const col = new Float32Array(n * 3);
      const piv = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(pos, i);
        c.set(typeof paint === 'function' ? paint(p) : paint);
        col.set([c.r, c.g, c.b], i * 3);
        piv.set(pivot, i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
      geo.setAttribute('aJoint', new THREE.BufferAttribute(new Float32Array(n).fill(joint), 1));
      geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
      if (geo !== g) g.dispose();
      return geo;
    });
    const merged = mergeGeometries(done, false);
    if (!merged) throw new Error('rig: parts could not be merged');
    done.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    this.parts = [];
    return merged;
  }
}

/** Every creature of one kind: an InstancedMesh, and the per-instance joint angles. */
export class Creatures {
  readonly mesh: THREE.InstancedMesh;
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly c: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];

  constructor(name: string, base: THREE.BufferGeometry, material: THREE.Material, readonly count: number) {
    // Share the base's vertex buffers; only the per-instance attributes are this mesh's own.
    const g = new THREE.BufferGeometry();
    for (const [k, attr] of Object.entries(base.attributes)) g.setAttribute(k, attr);
    g.boundingSphere = base.boundingSphere;
    this.a = new Float32Array(count * 4);
    this.b = new Float32Array(count * 4);
    this.c = new Float32Array(count * 4).fill(1);
    this.attrs = [this.a, this.b, this.c].map((arr) => new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iA', this.attrs[0]);
    g.setAttribute('iB', this.attrs[1]);
    g.setAttribute('iC', this.attrs[2]);
    this.mesh = new THREE.InstancedMesh(g, material, count);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** Pose one: its world matrix and joint angles (unset channels keep their values). */
  set(i: number, matrix: THREE.Matrix4, a?: readonly number[], b?: readonly number[], c?: readonly number[]) {
    this.mesh.setMatrixAt(i, matrix);
    if (a) this.a.set(a, i * 4);
    if (b) this.b.set(b, i * 4);
    if (c) this.c.set(c, i * 4);
  }

  flush() {
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of this.attrs) a.needsUpdate = true;
  }
}

const rx = new THREE.Matrix4();
const ry = new THREE.Matrix4();

/**
 * Where a point on the head ends up in world space, matching the shader: pitch, then yaw, about
 * the head's pivot, then the instance's matrix. For eyes that shine.
 */
export function headPoint(out: THREE.Vector3, local: V3, pivot: V3, pitch: number, yaw: number, matrix: THREE.Matrix4): THREE.Vector3 {
  out.set(local[0] - pivot[0], local[1] - pivot[1], local[2] - pivot[2]);
  out.applyMatrix4(rx.makeRotationX(pitch)).applyMatrix4(ry.makeRotationY(yaw));
  return out.set(out.x + pivot[0], out.y + pivot[1], out.z + pivot[2]).applyMatrix4(matrix);
}
