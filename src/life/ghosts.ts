import * as THREE from 'three';
import type { GhostGroup } from '../data';
import { makeGhost, type Ghost } from '../flight/ghost';
import { range, rng } from '../world/math';
import type { Living } from './types';

interface Npc {
  ghost: Ghost;
  c: THREE.Vector3;
  r: number;
  y: number;
  sp: number;
  ph: number;
}

/** Wandering ghosts on slow loops around their home points. */
export function makeGhosts(groups: GhostGroup[], anchors: Record<'gate' | 'hall' | 'pier', THREE.Vector3>): Living {
  const rand = rng(808);
  const rr = (a: number, b: number) => range(rand, a, b);
  const group = new THREE.Group();
  group.name = 'ghosts';
  const npcs: Npc[] = [];
  for (const g of groups) {
    const home = typeof g.home === 'string' ? anchors[g.home] : new THREE.Vector3(...g.home);
    for (let i = 0; i < g.count; i++) {
      const ghost = makeGhost(rand() * 10, 0.9);
      const r = rr(g.radius[0], g.radius[1]);
      const y = rr(g.rise[0], g.rise[1]);
      const sp = rr(g.speed[0], g.speed[1]) * (g.eitherWay && rand() < 0.5 ? -1 : 1);
      ghost.group.scale.setScalar(rr(g.scale[0], g.scale[1]));
      group.add(ghost.group);
      npcs.push({ ghost, c: home, r, y, sp, ph: rand() * 6.28 });
    }
  }
  return {
    object: group,
    update(_dt, time) {
      for (const n of npcs) {
        const a = n.ph + time * n.sp;
        const g = n.ghost.group;
        g.position.set(n.c.x + Math.cos(a) * n.r, n.c.y + n.y + Math.sin(time * 0.9 + n.ph) * 1.2, n.c.z + Math.sin(a) * n.r);
        g.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a)) + (n.sp < 0 ? Math.PI : 0);
        n.ghost.uniforms.uTime.value = time;
      }
    },
  };
}
