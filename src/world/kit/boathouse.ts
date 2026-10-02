import * as THREE from 'three';
import type { Vec2 } from '../../data';
import type { Heights } from '../heights';
import { box, lathe, prism, roofSlopes, segmentsFor } from './geom';
import type { Kit } from './kit';

export interface Boathouse {
  /** Where the lantern boat circles. */
  boatHome: THREE.Vector3;
  /** Warm light by the door. */
  light: THREE.Vector3;
  lanterns: THREE.Vector3[];
  /** Two spots along the roof ridge, where crows sit. */
  ridge: THREE.Vector3[];
}

/** The boathouse on the western shore, facing the lake, with a little tower and a pier. */
export function boathouse(k: Kit, heights: Heights, from: Vec2, toward: Vec2): Boathouse {
  const { M } = k;
  const [sx, sz] = heights.shore(from, toward);
  const dx = from[0] - sx;
  const dz = from[1] - sz;
  const dl = Math.hypot(dx, dz);
  const fx = dx / dl;
  const fz = dz / dl;
  const ix = sx - fx * 9;
  const iz = sz - fz * 9;
  const gy = Math.max(heights.terrain(ix, iz), 1);
  const bh = new THREE.Group();
  bh.position.set(ix, gy, iz);
  bh.rotation.y = Math.atan2(fx, fz);
  bh.updateMatrixWorld(true);
  const local = (x: number, y: number, z: number, ry = 0) => bh.matrixWorld.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));

  k.add(box(13, 8, 10), M.tower, local(0, 4, 0));
  // A solid attic (its ends are the gables) under slate slopes; the ridge runs along local x.
  const tri = new THREE.Shape([new THREE.Vector2(-7.5, 0), new THREE.Vector2(7.5, 0), new THREE.Vector2(0, 7)]);
  k.add(prism(tri, 13, 1), M.stone, local(0, 8, 0, Math.PI / 2));
  k.add(roofSlopes(13.6, 7.5, 7, 0.4, 0.12), M.slate, local(0, 8, 0));
  const r = 2.3;
  k.add(lathe([[r * 1.04, 0], [r, 14]], segmentsFor(r), 16), M.tower, local(6.5, 0, -4.5));
  k.add(lathe([[r + 0.6, 14], [r * 0.5, 15.5], [0.04, 23.5]], segmentsFor(r), 8), M.slate, local(6.5, 0, -4.5));

  const post = new THREE.CylinderGeometry(0.2, 0.2, 6, 6);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Vector3(-2, 0, 8 + i * 5).applyMatrix4(bh.matrixWorld);
    k.add(post, M.wood, new THREE.Matrix4().makeTranslation(p.x, -2, p.z));
  }
  // The pier deck is in world space so it sits on the water.
  const pd = new THREE.Vector3(-2, 0, 17).applyMatrix4(bh.matrixWorld);
  k.add(new THREE.BoxGeometry(3, 0.4, 24), M.wood, new THREE.Matrix4().compose(new THREE.Vector3(pd.x, 1, pd.z), bh.quaternion, new THREE.Vector3(1, 1, 1)));

  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(bh.matrixWorld);
  return {
    boatHome: at(10, 0, 40).setY(0),
    light: at(-2, 5, 14),
    lanterns: [at(-2, 0, 28).setY(3.8), at(-5, 6, 5.3), at(4, 6, 5.3)],
    ridge: [at(-4, 15.2, 0), at(3, 15.2, 0)],
  };
}
