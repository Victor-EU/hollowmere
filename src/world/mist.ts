import * as THREE from 'three';
import type { MistBank } from '../data';
import type { Heights } from './heights';
import { range, rng } from './math';

export interface Mist {
  group: THREE.Group;
  update(dt: number, time: number): void;
}

/**
 * Mist banks as soft sprites. Each sprite's lower edge is kept above the ground it floats over,
 * so it never slices into water or rock. (Soft particles that read the depth buffer replace this in M3.)
 */
export function makeMist(banks: MistBank[], heights: Heights, map: THREE.Texture, reduceMotion: boolean): Mist {
  const rand = rng(777);
  const rr = (a: number, b: number) => range(rand, a, b);
  const group = new THREE.Group();
  group.name = 'mist';
  const mists: { m: THREE.Sprite; base: THREE.Vector3; ph: number; sp: number }[] = [];
  const mk = (x: number, y: number, z: number, s: number, op: number, tint = 1) => {
    const m = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map,
        transparent: true,
        depthWrite: false,
        opacity: op,
        color: new THREE.Color(0.07 * tint, 0.08 * tint, 0.105 * tint),
      }),
    );
    y = Math.max(y, Math.max(heights.ground(x, z), heights.terrain(x, z), 0) + s * 0.2);
    m.material.rotation = rand() * 6;
    m.position.set(x, y, z);
    m.scale.set(s, s * 0.42, 1);
    group.add(m);
    mists.push({ m, base: m.position.clone(), ph: rand() * 6, sp: rr(0.01, 0.03) });
  };
  for (const b of banks) {
    for (let i = 0; i < b.count; i++) {
      let x: number;
      let y: number;
      let z: number;
      if ('ring' in b) {
        const a = rand() * Math.PI * 2;
        const r = rr(b.ring[0], b.ring[1]);
        x = Math.cos(a) * r;
        y = rr(b.y[0], b.y[1]);
        z = Math.sin(a) * r;
      } else {
        x = rr(b.min[0], b.max[0]);
        y = rr(b.min[1], b.max[1]);
        z = rr(b.min[2], b.max[2]);
      }
      mk(x, y, z, rr(b.size[0], b.size[1]), rr(b.opacity[0], b.opacity[1]), b.tint);
    }
  }
  return {
    group,
    update(dt, time) {
      for (const m of mists) {
        m.m.position.x = m.base.x + Math.sin(time * m.sp + m.ph) * 12;
        m.m.position.z = m.base.z + Math.cos(time * m.sp * 0.8 + m.ph) * 10;
        if (!reduceMotion) m.m.material.rotation += 0.004 * dt;
      }
    },
  };
}
