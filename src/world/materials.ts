import * as THREE from 'three';
import type { Textures } from './textures';

/**
 * Tuned emissive intensities (design doc §8). The first mockup pass used ~1.5x these and the
 * hall bloomed into white mush, so change them only while looking at the result.
 */
export const EMISSIVE = {
  towerWindow: 2.1,
  hallGlass: 1.55,
  pumpkinFace: 2.4,
};

export function makeMaterials(tex: Textures) {
  const slate = new THREE.MeshStandardMaterial({
    name: 'slate',
    map: tex.slate.map,
    bumpMap: tex.slate.bump,
    bumpScale: 0.04,
    roughness: 0.75,
    metalness: 0.08,
  });
  const slateDouble = slate.clone();
  slateDouble.name = 'slate-double';
  slateDouble.side = THREE.DoubleSide;
  return {
    /** Stone with the lit-window atlas in its emissive map. */
    tower: new THREE.MeshStandardMaterial({
      name: 'tower',
      map: tex.stoneWindows.map,
      bumpMap: tex.stoneWindows.bump,
      bumpScale: 0.035,
      emissiveMap: tex.stoneWindows.emissive,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: EMISSIVE.towerWindow,
      roughness: 0.92,
    }),
    stone: new THREE.MeshStandardMaterial({
      name: 'stone',
      map: tex.stonePlain.map,
      bumpMap: tex.stonePlain.bump,
      bumpScale: 0.035,
      roughness: 0.94,
    }),
    hall: new THREE.MeshStandardMaterial({
      name: 'hall',
      map: tex.hallBay.map,
      emissiveMap: tex.hallBay.emissive,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: EMISSIVE.hallGlass,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
    slate,
    slateDouble,
    iron: new THREE.MeshStandardMaterial({ name: 'iron', color: new THREE.Color('#16171c'), roughness: 0.5, metalness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ name: 'wood', color: new THREE.Color('#2a1b12'), roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ name: 'dark', color: new THREE.Color('#33343a'), roughness: 0.9 }),
  };
}

export type Materials = ReturnType<typeof makeMaterials>;
