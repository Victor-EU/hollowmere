import * as THREE from 'three';
import { StaticBatch } from '../batch';
import type { Rand } from '../math';
import type { Materials } from '../materials';

/**
 * Where kit pieces go: straight into one static batch, merged per material at the end. Pieces
 * can share a geometry (a merlon, a corbel); `finish` disposes them all. Everything but the
 * glass casts and receives shadows: the moon's shadow map is drawn once, so it costs nothing per
 * frame, and one mesh per material keeps the draw calls down.
 */
export class Kit {
  private batch = new StaticBatch();
  private owned = new Set<THREE.BufferGeometry>();

  constructor(
    readonly M: Materials,
    readonly rand: Rand,
  ) {}

  add(g: THREE.BufferGeometry, m: THREE.Material, at: THREE.Matrix4) {
    const shadows = m !== this.M.glass;
    this.batch.add(g, m, at, shadows, shadows);
    this.owned.add(g);
  }

  /** Add every mesh under an object, at its world transform (for pieces built as little groups). */
  addObject(o: THREE.Object3D) {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) this.add(mesh.geometry, mesh.material as THREE.Material, mesh.matrixWorld);
    });
  }

  finish(name: string): THREE.Group {
    const group = this.batch.build(name);
    for (const g of this.owned) g.dispose();
    this.owned.clear();
    return group;
  }
}
