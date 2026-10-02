import * as THREE from 'three';

/**
 * The scene is drawn in two goes (render/post.ts). Layer 0 first: everything that writes depth,
 * plus the sky. Then, with that depth resolved into a texture, the late layers: the see-through
 * things, sorted together, so that mist can fade softly wherever it meets geometry.
 */
export const LAYER = {
  /** Glows, flames, ghosts, cobwebs. Also drawn into the lake's reflection. */
  late: 1,
  /** Soft mist. Left out of the reflection, which has no depth texture of its own. */
  mist: 2,
} as const;

/** Move an object and everything under it to a late layer. */
export function drawLate(o: THREE.Object3D, layer: number = LAYER.late) {
  o.traverse((c) => c.layers.set(layer));
}

/** The opaque scene's depth, for soft particles. Filled in by the scene pass every frame. */
export const sceneDepth = {
  tDepth: { value: null as THREE.Texture | null },
  uNear: { value: 0.1 },
  uFar: { value: 1000 },
};
