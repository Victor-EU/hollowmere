import * as THREE from 'three';
import { box, prism } from './geom';
import type { Kit } from './kit';

export interface ViaductSpec {
  a: THREE.Vector3;
  b: THREE.Vector3;
  spans: number;
}

const PIER = 3.4;
const DEPTH = 6.6;
const BOTTOM = -15;

/**
 * Two tiers of round arches carrying a sloping deck, like a Roman aqueduct. Arches stay level
 * while the deck falls, as on a real sloping viaduct. Returns lantern spots along the parapets.
 */
export function viaduct(k: Kit, v: ViaductSpec): THREE.Vector3[] {
  const { M, rand } = k;
  const flat = new THREE.Vector3(v.b.x - v.a.x, 0, v.b.z - v.a.z);
  const L = flat.length();
  const ry = Math.atan2(-flat.z, flat.x);
  const frame = new THREE.Matrix4().compose(
    new THREE.Vector3(v.a.x, 0, v.a.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
    new THREE.Vector3(1, 1, 1),
  );
  const at = (x: number, y: number, z: number, rz = 0) =>
    frame.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz), new THREE.Vector3(1, 1, 1)));
  const deck = (x: number) => v.a.y + ((v.b.y - v.a.y) * x) / L;
  const n = v.spans;
  const s = L / n;
  const clear = s - PIER;
  const rad = clear / 2;

  // The arcade, drawn in its own vertical plane (x along, y up) and extruded across.
  const shape = new THREE.Shape();
  shape.moveTo(0, BOTTOM);
  for (let i = 0; i < n; i++) {
    const x0 = i * s;
    const mid = deck(x0 + s / 2);
    const spring = mid - 19 - rad;
    // Pier, then up its side, over the lower arch and down the next pier. absarc draws the
    // line up to its own start point; a separate lineTo there would leave a sliver edge.
    shape.lineTo(x0 + PIER / 2, BOTTOM);
    shape.absarc(x0 + s / 2, spring, rad, Math.PI, 0, true);
    shape.lineTo(x0 + s - PIER / 2, BOTTOM);
  }
  shape.lineTo(L, BOTTOM);
  shape.lineTo(L, deck(L) - 1.4);
  shape.lineTo(0, deck(0) - 1.4);
  shape.closePath();
  for (let i = 0; i < n; i++) {
    const x0 = i * s;
    const mid = deck(x0 + s / 2);
    const spring = mid - 4.2 - rad;
    const hole = new THREE.Path();
    hole.moveTo(x0 + PIER / 2, mid - 11);
    hole.lineTo(x0 + s - PIER / 2, mid - 11);
    hole.absarc(x0 + s / 2, spring, rad, 0, Math.PI, false);
    hole.closePath();
    shape.holes.push(hole);
  }
  k.add(prism(shape, DEPTH, 12), M.stone, frame);

  // Piers stand proud of the arcade below the string course (the end ones run into the rock).
  for (let i = 0; i <= n; i++) {
    const x = i * s;
    const top = deck(x) - 16;
    k.add(box(PIER, top - BOTTOM, DEPTH + 0.8, rand() * 16, 0), M.stone, at(x, (top + BOTTOM) / 2, 0));
    k.add(box(PIER + 0.3, 0.5, DEPTH + 1.1, rand() * 16, 0), M.stone, at(x, top + 0.25, 0));
  }
  // The string course between the tiers steps down span by span, like the arches.
  for (let i = 0; i < n; i++) {
    const x0 = i * s;
    const y = deck(x0 + s / 2) - 16.3;
    k.add(box(s + 0.02, 0.45, DEPTH + 0.35, rand() * 16, 0), M.stone, at(x0 + s / 2, y, 0));
  }
  // Deck, cornice and parapets follow the slope.
  const slope = Math.atan2(v.b.y - v.a.y, L);
  const run = Math.hypot(L, v.b.y - v.a.y);
  const along = (y: number) => at(L / 2, deck(L / 2) + y, 0, slope);
  k.add(box(run + 3, 1.4, 7.4, rand() * 8, rand() * 8), M.floor, along(-0.7));
  k.add(box(run + 3, 0.4, 7.9, rand() * 16, 0), M.stone, along(-1.55));
  for (const z of [-3.3, 3.3]) {
    k.add(box(run + 3, 1.5, 0.8, rand() * 16, 0), M.stone, along(0.75).multiply(new THREE.Matrix4().makeTranslation(0, 0, z)));
    k.add(box(run + 3, 0.22, 1.05, rand() * 16, 0), M.stone, along(1.61).multiply(new THREE.Matrix4().makeTranslation(0, 0, z)));
  }

  const lanterns: THREE.Vector3[] = [];
  const m = along(0);
  for (let x = -run / 2; x <= run / 2; x += 7.5) for (const z of [-3.3, 3.3]) lanterns.push(new THREE.Vector3(x, 2.2, z).applyMatrix4(m));
  return lanterns;
}
