import * as THREE from 'three';
import { look, onLook } from '../render/look';
import type { TextureId, TextureLibrary } from './assets';

/**
 * A standard material on one of the library's texture sets. It shows `flat` until the set's
 * preview arrives, and stays that colour if the textures haven't been processed.
 */
function textured(lib: TextureLibrary, id: TextureId, name: string, flat: string, extra: THREE.MeshStandardMaterialParameters = {}) {
  const set = lib.info(id);
  const m = new THREE.MeshStandardMaterial({ name, roughness: set.roughness, metalness: set.metalness, color: new THREE.Color(flat), ...extra });
  lib.bind(m, id, flat);
  return m;
}

/**
 * Emissive intensities come from data/look.json. They are tuned against the bloom (design doc §8):
 * the first mockup pass used ~1.5x and the hall bloomed into white mush, so change them only
 * while looking at the result.
 */
export function makeMaterials(lib: TextureLibrary) {
  const M = {
    /** Castle stone with the window atlas: lit windows are in its emissive map. */
    tower: textured(lib, 'tower-windows', 'tower', '#524f4a'),
    stone: textured(lib, 'stone', 'stone', '#524f4a'),
    floor: textured(lib, 'flagstone', 'floor', '#4b4844'),
    /** The great hall's stained glass, mapped once per window. You fly in through it. */
    glass: textured(lib, 'hall-glass', 'glass', '#3a2a1e', { side: THREE.DoubleSide }),
    slate: textured(lib, 'slate', 'slate', '#2f3236'),
    slateDouble: textured(lib, 'slate', 'slate-double', '#2f3236', { side: THREE.DoubleSide }),
    iron: new THREE.MeshStandardMaterial({ name: 'iron', color: new THREE.Color('#16171c'), roughness: 0.5, metalness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ name: 'wood', color: new THREE.Color('#2a1b12'), roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ name: 'dark', color: new THREE.Color('#33343a'), roughness: 0.9 }),
    /** The hall's table linen and the carpet up its aisle; the high table's velvet; gilt. */
    cloth: new THREE.MeshStandardMaterial({ name: 'cloth', color: new THREE.Color('#5e1622'), roughness: 0.95 }),
    velvet: new THREE.MeshStandardMaterial({ name: 'velvet', color: new THREE.Color('#38184a'), roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ name: 'gold', color: new THREE.Color('#c9a24a'), roughness: 0.38, metalness: 0.55 }),
  };
  onLook(() => {
    M.tower.emissiveIntensity = look.emissive.towerWindow;
    M.glass.emissiveIntensity = look.emissive.hallGlass;
    M.glass.emissive.set(look.emissive.hallGlassTint);
  });
  return M;
}

export type Materials = ReturnType<typeof makeMaterials>;
