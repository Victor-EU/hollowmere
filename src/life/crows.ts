import * as THREE from 'three';
import { range, rng } from '../world/math';
import type { LifeContext, Living } from './types';

/** Caws carry this far; the event player drops anything beyond its own range anyway. */
const HEARD = 170;

/**
 * Crows, heard but not yet seen (design doc §10 puts them on the bare trees by the gate and on
 * the boathouse ridge): every so often one of the perches within earshot caws, once or twice.
 */
export function makeCrows(perches: THREE.Vector3[], every: [number, number], ctx: LifeContext): Living {
  const rand = rng(613);
  let wait = range(rand, ...every) * 0.5;
  return {
    object: new THREE.Group(),
    update(dt) {
      wait -= dt;
      if (wait > 0) return;
      wait = range(rand, ...every);
      const near = perches.filter((p) => p.distanceTo(ctx.player) < HEARD);
      if (near.length) ctx.sound('caw', near[Math.floor(rand() * near.length)]);
    },
  };
}
