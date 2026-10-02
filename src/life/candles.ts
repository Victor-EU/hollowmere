import * as THREE from 'three';
import type { Castle } from '../world/castle';
import { range, rng } from '../world/math';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

/** Floating candles in the great hall. */
export function makeCandles(count: number, hall: Castle['hall'], ctx: LifeContext): Living {
  const rand = rng(1500);
  const rr = (a: number, b: number) => range(rand, a, b);
  const group = new THREE.Group();
  group.name = 'candles';
  const im = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.6, 6),
    new THREE.MeshStandardMaterial({ name: 'candle', color: new THREE.Color('#efe6d2'), emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0.25, roughness: 0.6 }),
    count,
  );
  im.frustumCulled = false;
  const glow = new Pool(count);
  group.add(im, glow.points);
  const candles = Array.from({ length: count }, () => ({
    x: rr(hall.x0 + 2, hall.x1 - 2),
    y: rr(hall.y0 + 8, hall.y0 + 19),
    z: rr(hall.z0 + 2, hall.z1 - 2),
    ph: rand() * 6.28,
  }));
  const d = new THREE.Object3D();
  return {
    object: group,
    update(_dt, time) {
      candles.forEach((c, i) => {
        const y = c.y + (ctx.reduceMotion ? 0 : Math.sin(time * 0.7 + c.ph) * 0.35);
        d.position.set(c.x, y, c.z);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        glow.pos.set([c.x, y + 0.48, c.z], i * 3);
        const fl = 0.8 + 0.2 * Math.sin(time * 13 + c.ph * 5);
        glow.col.set([1.8 * fl, 1.0 * fl, 0.32 * fl, 0.9], i * 4);
        glow.size[i] = 0.9;
      });
      im.instanceMatrix.needsUpdate = true;
      glow.flush();
    },
  };
}
