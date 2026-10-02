import type * as THREE from 'three';

/**
 * Shadows. The world is static, so the moon's map is drawn once, on the first frame, with
 * everything that casts. Then `bakeShadows` stops all of it casting except what's marked
 * `userData.spotCaster` (the player ghost's stand-in), and from then on the only map that is
 * redrawn is the Warden's lantern spotlight (life/warden.ts), and only while it's needed. That
 * keeps its redraws to a single small mesh instead of the whole castle.
 *
 * Anything that later asks the moon's map to redraw would find nothing casting: call
 * `bakeShadows` again only after restoring the casters.
 */
export const shadows = { baked: false };

export function bakeShadows(scene: THREE.Scene) {
  scene.traverse((o) => {
    // Casters only: the lights keep casting, or their maps (and the shaders that read them) go.
    if (!(o as THREE.Light).isLight) o.castShadow = !!o.userData.spotCaster;
  });
  shadows.baked = true;
}
