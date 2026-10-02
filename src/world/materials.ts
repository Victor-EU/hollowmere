import * as THREE from 'three';
import { look, onLook } from '../render/look';
import type { Library, TextureSet } from './assets';

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

/**
 * Emissive intensities come from data/look.json. They are tuned against the bloom (design doc §8):
 * the first mockup pass used ~1.5x and the hall bloomed into white mush, so change them only
 * while looking at the result.
 */
export function makeMaterials(lib: Library) {
  const slate = textured('slate', lib.slate, '#2f3236');
  const slateDouble = slate.clone();
  slateDouble.name = 'slate-double';
  slateDouble.side = THREE.DoubleSide;
  const M = {
    /** Castle stone with the window atlas: lit windows are in its emissive map. */
    tower: textured('tower', lib['tower-windows'], '#524f4a'),
    stone: textured('stone', lib.stone, '#524f4a'),
    floor: textured('floor', lib.flagstone, '#4b4844'),
    /** The great hall's stained glass, mapped once per window. You fly in through it. */
    glass: textured('glass', lib['hall-glass'], '#3a2a1e', { side: THREE.DoubleSide }),
    slate,
    slateDouble,
    iron: new THREE.MeshStandardMaterial({ name: 'iron', color: new THREE.Color('#16171c'), roughness: 0.5, metalness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ name: 'wood', color: new THREE.Color('#2a1b12'), roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ name: 'dark', color: new THREE.Color('#33343a'), roughness: 0.9 }),
  };
  onLook(() => {
    M.tower.emissiveIntensity = look.emissive.towerWindow;
    M.glass.emissiveIntensity = look.emissive.hallGlass;
    M.glass.emissive.set(look.emissive.hallGlassTint);
  });
  return M;
}

export type Materials = ReturnType<typeof makeMaterials>;
