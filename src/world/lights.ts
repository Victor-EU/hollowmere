import * as THREE from 'three';
import type { WorldData } from '../data';
import { staticGlow } from '../life/sprites';
import { look, onLook } from '../render/look';
import { rng } from './math';
import type { Materials } from './materials';

export const WARM_DECAY = 1;

export interface Lights {
  group: THREE.Group;
  update(time: number): void;
}

/**
 * Moonlight with a one-off shadow map, a hemisphere fill, a cold fill from the far side and a few
 * warm point lights. Colours and intensities of the first three come from data/look.json.
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
  /** The quality tier's cap on the moon's map. */
  maxShadowMap: number,
): Lights {
  const L = world.lights;
  const group = new THREE.Group();
  group.name = 'lights';

  const hemi = new THREE.HemisphereLight();
  group.add(hemi);

  const centre = new THREE.Vector3(...world.castleCentre);
  const moon = new THREE.DirectionalLight();
  moon.name = 'moon';
  // Skylight from the side away from the moon. Without it the walls facing the lake go black: the
  // hemisphere light reaches a vertical wall only half from the sky, and the stone is dark. No shadows.
  const fill = new THREE.DirectionalLight();
  fill.name = 'fill';
  fill.position.copy(centre).addScaledVector(new THREE.Vector3(-moonDir.x, 0.5, -moonDir.z).normalize(), 500);
  fill.target.position.copy(centre);
  group.add(fill, fill.target);
  onLook(() => {
    hemi.color.set(look.hemisphere.sky);
    hemi.groundColor.set(look.hemisphere.ground);
    hemi.intensity = look.hemisphere.intensity;
    moon.color.set(look.moonlight.color);
    moon.intensity = look.moonlight.intensity;
    fill.color.set(look.fill.color);
    fill.intensity = look.fill.intensity;
  });
  moon.position.copy(centre).addScaledVector(moonDir, 500);
  moon.target.position.copy(centre);
  moon.castShadow = true;
  const e = L.moonShadow.extent;
  Object.assign(moon.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 100, far: 1100 });
  const mapSize = Math.min(L.moonShadow.mapSize, maxShadowMap);
  moon.shadow.mapSize.set(mapSize, mapSize);
  // Drawn once: the world is static (render/shadows.ts).
  moon.shadow.autoUpdate = false;
  moon.shadow.needsUpdate = true;
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
