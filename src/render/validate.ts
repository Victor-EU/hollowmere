import type * as THREE from 'three';

/**
 * Dev-only: find NaN or Infinity in any geometry attribute before it reaches the GPU.
 * A single NaN vertex in the mockup's ghost made bloom smear black blocks across the screen.
 */
export function validateScene(root: THREE.Object3D): string[] {
  const problems: string[] = [];
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g || seen.has(g)) return;
    seen.add(g);
    for (const [name, attr] of Object.entries(g.attributes)) {
      const a = attr.array;
      for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i])) {
          problems.push(`${o.name || o.type} (${g.type}): ${name}[${i}] = ${a[i]}`);
          break;
        }
      }
    }
  });
  return problems;
}
