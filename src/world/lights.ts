import * as THREE from 'three';
import type { WorldData } from '../data';
import { staticGlow } from '../life/sprites';
import { rng } from './math';
import type { Materials } from './materials';

export const WARM_DECAY = 1;

export interface Lights {
  group: THREE.Group;
  update(time: number): void;
}

/**
 * Moonlight with a one-off shadow map, a hemisphere fill and a few warm point lights.
 * The mockup ran on three's legacy lights. Directional and hemisphere intensities are x pi.
 * Warm lights use decay 1, which keeps the legacy falloff's gentle shape instead of inverse
 * square's hot spots, with intensity = legacy x 0.47 x distance (matched at 30% of range).
 */
export function makeLights(
  world: WorldData,
  M: Materials,
  moonDir: THREE.Vector3,
  boathouse: THREE.Vector3,
  lanternSpots: THREE.Vector3[],
): Lights {
  const L = world.lights;
  const group = new THREE.Group();
  group.name = 'lights';

  group.add(new THREE.HemisphereLight(new THREE.Color(L.hemisphere.sky), new THREE.Color(L.hemisphere.ground), L.hemisphere.intensity));

  const centre = new THREE.Vector3(...world.castleCentre);
  const moon = new THREE.DirectionalLight(new THREE.Color(L.moon.color), L.moon.intensity);
  moon.name = 'moon';
  moon.position.copy(centre).addScaledVector(moonDir, 500);
  moon.target.position.copy(centre);
  moon.castShadow = true;
  const e = L.moon.shadowExtent;
  Object.assign(moon.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 100, far: 1100 });
  moon.shadow.mapSize.set(L.moon.shadowMap, L.moon.shadowMap);
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.5;
  // Stands in for the mockup's PCFSoftShadowMap, which three removed.
  moon.shadow.radius = 2.5;
  group.add(moon, moon.target);

  const flickering: { light: THREE.PointLight; base: number; depth: number }[] = [];
  const warm = (at: THREE.Vector3, intensity: number, distance: number, color = '#ff8a3a', flicker = 0) => {
    const l = new THREE.PointLight(new THREE.Color(color), intensity, distance, WARM_DECAY);
    l.position.copy(at);
    group.add(l);
    if (flicker) flickering.push({ light: l, base: intensity, depth: flicker });
  };
  for (const w of L.warm) warm(new THREE.Vector3(...w.at), w.intensity, w.distance, w.color, w.flicker);
  warm(boathouse, 30, 40);

  // Lanterns along the route: a glow sprite each, and one instanced draw for their iron cages.
  group.add(staticGlow(lanternSpots, [2.2, 1.1, 0.35], 2.6, rng(12)));
  const cages = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.7, 0.45), M.iron, lanternSpots.length);
  cages.name = 'lanterns';
  const d = new THREE.Object3D();
  lanternSpots.forEach((p, i) => {
    d.position.copy(p);
    d.updateMatrix();
    cages.setMatrixAt(i, d.matrix);
  });
  group.add(cages);

  return {
    group,
    update(time) {
      // Two slow beats per light, offset so they don't pulse together. Well under 3 Hz.
      flickering.forEach((f, k) => {
        const wave = Math.sin(time * 7 + k) * Math.sin(time * 3.1 + k * 1.7);
        f.light.intensity = f.base * (1 - f.depth + f.depth * wave);
      });
    },
  };
}
