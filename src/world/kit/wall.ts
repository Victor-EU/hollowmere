import * as THREE from 'three';
import { box } from './geom';
import type { Kit } from './kit';

export interface WallSpec {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  base: number;
  top: number;
  thickness: number;
  /** A point on the outside; the crenellated parapet faces it. */
  outside: [number, number];
}

/** A curtain wall: body, wall walk, a crenellated parapet outside and a low one inside. */
export function curtainWall(k: Kit, w: WallSpec) {
  const { M, rand } = k;
  const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
  const h = w.top - w.base;
  const ry = Math.atan2(-(w.bz - w.az), w.bx - w.ax);
  const frame = new THREE.Matrix4().compose(
    new THREE.Vector3((w.ax + w.bx) / 2, 0, (w.az + w.bz) / 2),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
    new THREE.Vector3(1, 1, 1),
  );
  // Local +z is the wall's left; which side is outside?
  const nz = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  const mid = new THREE.Vector3((w.ax + w.bx) / 2, 0, (w.az + w.bz) / 2);
  const s = nz.dot(new THREE.Vector3(w.outside[0] - mid.x, 0, w.outside[1] - mid.z)) > 0 ? 1 : -1;
  const at = (x: number, y: number, z: number) => frame.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  const half = w.thickness / 2;

  k.add(box(len, h, w.thickness, rand() * 16, rand() * 16), M.stone, at(0, w.base + h / 2, 0));
  // Outer parapet and merlons.
  k.add(box(len, 1.25, 0.62, rand() * 16, 0), M.stone, at(0, w.top + 0.62, s * (half - 0.31)));
  const n = Math.floor(len / 2.6);
  for (let i = 1; i < n; i++) {
    const x = -len / 2 + (i * len) / n;
    k.add(box(1.5, 1.2, 0.62, rand() * 16, rand() * 16), M.stone, at(x, w.top + 1.25 + 0.6, s * (half - 0.31)));
  }
  // A string of corbels under the outer parapet's lip.
  k.add(box(len, 0.35, 0.3, rand() * 16, 0), M.stone, at(0, w.top - 0.25, s * (half + 0.15)));
  // Inner parapet, lower.
  k.add(box(len, 0.85, 0.45, rand() * 16, 0), M.stone, at(0, w.top + 0.42, -s * (half - 0.22)));
}
