import * as THREE from 'three';
import type { Library, TextureSet } from './assets';

/**
 * Tuned emissive intensities (design doc §8). The first mockup pass used ~1.5x these and the
 * hall bloomed into white mush, so change them only while looking at the result.
 */
export const EMISSIVE = {
  towerWindow: 2.1,
  hallGlass: 1.55,
  pumpkinFace: 2.4,
};

/** A textured standard material; without its textures (not processed yet) it falls back to `flat`. */
function textured(name: string, set: TextureSet, flat: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  const m = new THREE.MeshStandardMaterial({
    name,
    map: set.map,
    normalMap: set.normalMap,
    roughness: set.roughness,
    metalness: set.metalness,
    color: set.map ? 0xffffff : new THREE.Color(flat),
    ...extra,
  });
  if (set.emissiveMap) {
    m.emissiveMap = set.emissiveMap;
    m.emissive = new THREE.Color(0xffffff);
  }
  return m;
}

export function makeMaterials(lib: Library) {
  const slate = textured('slate', lib.slate, '#2f3236');
  const slateDouble = slate.clone();
  slateDouble.name = 'slate-double';
  slateDouble.side = THREE.DoubleSide;
  return {
    /** Castle stone with the window atlas: lit windows are in its emissive map. */
    tower: textured('tower', lib['tower-windows'], '#524f4a', { emissiveIntensity: EMISSIVE.towerWindow }),
    stone: textured('stone', lib.stone, '#524f4a'),
    floor: textured('floor', lib.flagstone, '#4b4844'),
    /** The great hall's stained glass, mapped once per window. You fly in through it. */
    glass: textured('glass', lib['hall-glass'], '#3a2a1e', { emissiveIntensity: EMISSIVE.hallGlass, side: THREE.DoubleSide }),
    slate,
    slateDouble,
    iron: new THREE.MeshStandardMaterial({ name: 'iron', color: new THREE.Color('#16171c'), roughness: 0.5, metalness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ name: 'wood', color: new THREE.Color('#2a1b12'), roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ name: 'dark', color: new THREE.Color('#33343a'), roughness: 0.9 }),
  };
}

export type Materials = ReturnType<typeof makeMaterials>;
