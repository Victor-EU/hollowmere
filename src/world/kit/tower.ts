import * as THREE from 'three';
import { box, lathe, matrix, segmentsFor, type Profile } from './geom';
import type { Kit } from './kit';

export interface TowerSpec {
  x: number;
  z: number;
  r: number;
  /** Shaft height above `base`. */
  h: number;
  spire: number;
  base: number;
  /** The big towers: a crenellated gallery with four pinnacle turrets round the spire. */
  pinnacles?: boolean;
}

/** Window rows in the tower atlas: 16 m tile, three floors. String courses go between them. */
const FLOOR = 16 / 3;

/** Corbels round the top of the shaft, carrying the overhanging gallery. */
function corbels(k: Kit, t: TowerSpec, top: number, phase: number) {
  const n = Math.max(8, Math.round((2 * Math.PI * t.r) / 1.15));
  const low = box(0.46, 0.55, 0.5);
  const high = box(0.46, 0.6, 0.85);
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const at = (r: number, y: number) => matrix(t.x + Math.cos(a) * r, y, t.z - Math.sin(a) * r, a + Math.PI / 2);
    k.add(low, k.M.stone, at(t.r + 0.18, top - 0.95));
    k.add(high, k.M.stone, at(t.r + 0.36, top - 0.32));
  }
}

/** A ring of merlons on a parapet of radius r. */
function merlonRing(k: Kit, x: number, z: number, r: number, y: number, phase: number) {
  const n = Math.max(6, Math.round((2 * Math.PI * r) / 2.3));
  const g = box(1.25, 1.1, 0.55);
  for (let i = 0; i < n; i++) {
    const a = phase + ((i + 0.5) / n) * Math.PI * 2;
    k.add(g, k.M.stone, matrix(x + Math.cos(a) * r, y + 0.55, z - Math.sin(a) * r, a + Math.PI / 2));
  }
}

function finial(k: Kit, x: number, y: number, z: number, r: number) {
  const h = 3 + r * 0.35;
  k.add(new THREE.ConeGeometry(Math.max(0.16, r * 0.04), h, 6), k.M.iron, matrix(x, y + h / 2, z));
  k.add(new THREE.SphereGeometry(Math.max(0.2, r * 0.045), 8, 6), k.M.iron, matrix(x, y + h * 0.3, z));
}

/** A bell-cast cone: the eaves kick out, then it runs straight to the point. */
function spireProfile(rEave: number, y0: number, sp: number, soffit: number): Profile {
  return [
    [soffit, y0],
    [rEave, y0],
    [rEave * 0.86, y0 + sp * 0.06],
    [rEave * 0.62, y0 + sp * 0.3],
    [rEave * 0.3, y0 + sp * 0.65],
    [0.04, y0 + sp],
  ];
}

export function tower(k: Kit, t: TowerSpec) {
  const { M } = k;
  const seg = segmentsFor(t.r * 1.25);
  const top = t.base + t.h;
  const phase = k.rand() * Math.PI * 2;
  const at = (y = 0) => matrix(t.x, y, t.z);
  const rAt = (y: number) => t.r * (1.03 - (0.03 * (y - t.base)) / t.h);

  // Shaft in the window atlas. v is world height, so its window floors fall on multiples of
  // FLOOR, and string courses can run between them.
  k.add(lathe([[t.r * 1.03, t.base], [t.r, top]], seg, 16, t.base, phase), M.tower, at());
  const courses = t.h > 40 ? [0.42, 0.72] : [0.55];
  for (const f of courses) {
    const y = Math.round((t.base + t.h * f) / FLOOR) * FLOOR + 0.35;
    if (y > top - 4) continue;
    const r = rAt(y);
    k.add(lathe([[r, y - 0.22], [r + 0.22, y - 0.08], [r + 0.22, y + 0.14], [r, y + 0.2]], seg, 16, 0, phase), M.stone, at());
  }
  corbels(k, t, top, phase);

  if (t.pinnacles) {
    // Crenellated gallery; the spire rises from inside it, ringed by four pinnacle turrets.
    const ro = t.r + 0.85;
    k.add(lathe([[t.r, top], [ro, top], [ro, top + 1.45], [ro - 0.55, top + 1.45], [ro - 0.55, top + 0.3], [t.r * 0.9, top + 0.3]], seg, 16, 0, phase), M.stone, at());
    merlonRing(k, t.x, t.z, ro - 0.28, top + 1.45, phase);
    const y0 = top + 0.3;
    k.add(lathe(spireProfile(t.r * 0.97, y0, t.spire, t.r * 0.5), seg, 8, 0, phase), M.slate, at());
    finial(k, t.x, y0 + t.spire, t.z, t.r);
    const rp = Math.max(0.55, t.r * 0.12);
    const ph = 3.2 + t.r * 0.25;
    for (let i = 0; i < 4; i++) {
      const a = phase + Math.PI / 4 + (i * Math.PI) / 2;
      const px = t.x + Math.cos(a) * (ro - 0.3);
      const pz = t.z - Math.sin(a) * (ro - 0.3);
      const ps = segmentsFor(rp, 8, 12);
      k.add(lathe([[rp, top + 1.45], [rp, top + 1.45 + ph], [rp * 1.2, top + 1.45 + ph], [rp * 1.2, top + 1.85 + ph]], ps, 16), M.stone, matrix(px, 0, pz));
      const sp = t.r * 0.9 + 2.5;
      k.add(lathe(spireProfile(rp * 1.3, top + 1.85 + ph, sp, rp * 0.6), ps, 8), M.slate, matrix(px, 0, pz));
      finial(k, px, top + 1.85 + ph + sp, pz, rp);
    }
  } else {
    // Machicolated gallery under an overhanging candle-snuffer spire.
    const ro = t.r + 0.8;
    k.add(lathe([[t.r, top], [ro, top], [ro, top + 1.9]], seg, 16, 0, phase), M.stone, at());
    const y0 = top + 1.6;
    k.add(lathe(spireProfile(t.r + 1.15, y0, t.spire, t.r * 0.7), seg, 8, 0, phase), M.slate, at());
    finial(k, t.x, y0 + t.spire, t.z, t.r);
  }
}
