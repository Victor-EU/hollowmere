import * as THREE from 'three';
import { gargoyleHead } from '../world/kit/gate';
import { clamp } from '../world/math';
import type { Materials } from '../world/materials';
import type { LifeContext, Living } from './types';

/** Radians a second: stone turns slowly. */
const TURN = 0.55;
const MAX_YAW = 1.3;
const PITCH: [number, number] = [-0.45, 0.6];
/** Seconds between grinds from one head. */
const GRIND_GAP = 1.8;

/**
 * The gate gargoyles' heads (design doc §10). Hover within `reach` and a head turns, slowly, to
 * follow you, grinding stone on stone as it starts; leave and it grinds back to face the road.
 * The only wrong thing a statue does, so only this pair does it. One instanced draw for both.
 */
export function makeGargoyles(necks: THREE.Vector3[], reach: number, M: Materials, ctx: LifeContext): Living {
  const mesh = new THREE.InstancedMesh(gargoyleHead(), M.dark, necks.length);
  mesh.name = 'gargoyle-heads';
  const heads = necks.map(() => ({ yaw: 0, pitch: 0, near: false, moving: false, quiet: GRIND_GAP }));
  const o = new THREE.Object3D();
  o.rotation.order = 'YXZ';
  const place = (i: number) => {
    o.position.copy(necks[i]);
    o.rotation.set(heads[i].pitch, heads[i].yaw, 0);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  };
  necks.forEach((_, i) => place(i));

  const step = (from: number, to: number, dt: number) => {
    const d = to - from;
    // Constant speed, easing over the last few degrees.
    return from + Math.sign(d) * Math.min(Math.abs(d), Math.min(TURN, 2.5 * Math.abs(d)) * dt);
  };

  return {
    object: mesh,
    update(dt) {
      const P = ctx.player;
      necks.forEach((n, i) => {
        const h = heads[i];
        const dx = P.x - n.x;
        const dy = P.y - n.y;
        const dz = P.z - n.z;
        h.near = Math.hypot(dx, dy, dz) < reach + (h.near ? 1.5 : 0);
        const flat = Math.hypot(dx, dz);
        const yaw = h.near ? clamp(Math.atan2(dx, dz), -MAX_YAW, MAX_YAW) : 0;
        // +x pitches the face down, toward a ghost below.
        const pitch = h.near ? clamp(Math.atan2(-dy, flat), ...PITCH) : 0;
        const err = Math.max(Math.abs(yaw - h.yaw), Math.abs(pitch - h.pitch));
        h.quiet += dt;
        if (!h.moving && err > 0.12) {
          h.moving = true;
          if (h.quiet > GRIND_GAP) {
            ctx.sound('grind', n);
            h.quiet = 0;
          }
        } else if (h.moving && err < 0.02) h.moving = false;
        if (err < 1e-4) return;
        h.yaw = step(h.yaw, yaw, dt);
        h.pitch = step(h.pitch, pitch, dt);
        place(i);
      });
    },
  };
}
