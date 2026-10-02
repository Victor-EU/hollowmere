import * as THREE from 'three';
import { look } from '../data';

export { look };

const appliers: (() => void)[] = [];

/**
 * Apply part of data/look.json now, and again whenever the dev look panel changes it. In
 * production nothing changes after start, so each applier runs once.
 */
export function onLook(apply: () => void) {
  appliers.push(apply);
  apply();
}

/** The look data was edited in place: push it into every uniform, light and material. */
export function lookChanged() {
  for (const apply of appliers) apply();
}

/** A hex colour as display (sRGB) values, for the grade pass, which works after tone mapping. */
export function displayRGB(hex: string, out = new THREE.Vector3()): THREE.Vector3 {
  const c = new THREE.Color(hex).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return out.set(c.r, c.g, c.b);
}
