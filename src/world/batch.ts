import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Entry {
  material: THREE.Material;
  cast: boolean;
  receive: boolean;
  geometries: THREE.BufferGeometry[];
}

/**
 * Collects static meshes and merges them per material and shadow flags, so the whole castle
 * costs a handful of draw calls instead of hundreds. Nothing visual changes.
 */
export class StaticBatch {
  private entries = new Map<string, Entry>();

  /** Add a mesh (with its current world transform). The mesh itself is not kept. */
  addMesh(mesh: THREE.Mesh) {
    mesh.updateWorldMatrix(true, false);
    this.add(mesh.geometry, mesh.material as THREE.Material, mesh.matrixWorld, mesh.castShadow, mesh.receiveShadow);
  }

  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4, cast = true, receive = true) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.applyMatrix4(matrix);
    // A mirrored transform flips winding; undo it so faces still point outward.
    if (matrix.determinant() < 0) {
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        for (const a of Object.values(g.attributes)) {
          const s = a.itemSize;
          for (let k = 0; k < s; k++) {
            const t = a.array[(i + 1) * s + k];
            a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
            a.array[(i + 2) * s + k] = t;
          }
        }
      }
    }
    const key = `${material.uuid}|${cast}|${receive}`;
    const entry = this.entries.get(key) ?? { material, cast, receive, geometries: [] };
    entry.geometries.push(g);
    this.entries.set(key, entry);
  }

  build(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const e of this.entries.values()) {
      const merged = mergeGeometries(e.geometries, false);
      if (!merged) throw new Error(`${name}: could not merge geometries for ${e.material.name}`);
      e.geometries.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, e.material);
      mesh.name = `${name}-${e.material.name || 'material'}`;
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      group.add(mesh);
    }
    this.entries.clear();
    return group;
  }
}
