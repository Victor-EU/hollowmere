import * as THREE from 'three';
import type { WorldData } from '../data';
import { range, rng } from '../world/math';
import { WARM_DECAY } from '../world/lights';
import type { Materials } from '../world/materials';
import { Pool, staticGlow } from './sprites';
import type { Living } from './types';

// 1.6 over 30 m in the mockup's legacy units, converted as in world/lights.ts.
const BOAT_LIGHT = 22.5;

/** Will-o'-wisps over the water and the lantern boat looping near the pier. */
export function makeLake(world: WorldData, M: Materials, boatHome: THREE.Vector3): Living {
  const rand = rng(4040);
  const rr = (a: number, b: number) => range(rand, a, b);
  const group = new THREE.Group();
  group.name = 'lake-life';

  const w = world.life.wisps;
  const wisps = new Pool(w.count);
  const wispData = Array.from({ length: w.count }, () => ({
    c: new THREE.Vector3(rr(w.min[0], w.max[0]), rr(w.min[1], w.max[1]), rr(w.min[2], w.max[2])),
    r: rr(w.radius[0], w.radius[1]),
    sp: rr(w.speed[0], w.speed[1]),
    ph: rand() * 6.28,
  }));
  group.add(wisps.points);

  const boat = new THREE.Group();
  boat.name = 'lantern-boat';
  const part = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    boat.add(o);
    return o;
  };
  part(new THREE.BoxGeometry(2.4, 1, 7), M.wood, 0, 0.3, 0);
  const prow = part(new THREE.ConeGeometry(1.2, 2.6, 4), M.wood, 0, 0.3, 4.4);
  prow.rotation.x = Math.PI / 2;
  prow.rotation.y = Math.PI / 4;
  prow.scale.set(1, 1, 0.45);
  part(new THREE.BoxGeometry(1.8, 1.6, 2.4), M.dark, 0, 1.5, -1.5);
  part(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 5), M.iron, 0, 2.4, 2.3);
  const light = new THREE.PointLight(new THREE.Color('#ff8a3a'), BOAT_LIGHT, 30, WARM_DECAY);
  const glow = staticGlow([new THREE.Vector3()], [3.2, 1.8, 0.6], 3.2, rand);
  group.add(boat, light, glow);

  const lamp = new THREE.Vector3();
  return {
    object: group,
    update(_dt, time) {
      wispData.forEach((d, i) => {
        const a = d.ph + time * d.sp;
        wisps.pos.set([d.c.x + Math.cos(a) * d.r, d.c.y + Math.sin(time * 1.1 + d.ph) * 1.5, d.c.z + Math.sin(a * 1.3) * d.r], i * 3);
        const fl = 0.7 + 0.3 * Math.sin(time * 3 + d.ph * 4);
        wisps.col.set([0.35 * fl, 1.3 * fl, 1.15 * fl, 0.9], i * 4);
        wisps.size[i] = 2.2;
      });
      wisps.flush();

      const a = time * 0.03;
      boat.position.set(boatHome.x + Math.cos(a) * 34, 0.1 + Math.sin(time * 1.2) * 0.12, boatHome.z + Math.sin(a) * 22);
      boat.rotation.y = Math.atan2(-Math.sin(a) * 34, Math.cos(a) * 22);
      boat.rotation.z = Math.sin(time * 0.9) * 0.04;
      boat.updateMatrixWorld();
      boat.localToWorld(lamp.set(0, 4.1, 2.3));
      light.position.copy(lamp);
      const pos = glow.geometry.getAttribute('position');
      pos.setXYZ(0, lamp.x, lamp.y, lamp.z);
      pos.needsUpdate = true;
    },
  };
}
