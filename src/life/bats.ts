import * as THREE from 'three';
import type { Vec3 } from '../data';
import { range, rng } from '../world/math';
import type { LifeContext, Living } from './types';

/** A bat this near chitters (design doc §10). */
const CHITTER = 15;

/** Flocks of flat two-wing bats circling the towers. Two instanced draws for all of them. */
export function makeBats(flocks: { center: Vec3; count: number; radius?: [number, number]; rise?: number }[], ctx: LifeContext): Living {
  const rand = rng(909);
  const rr = (a: number, b: number) => range(rand, a, b);
  const wing = (() => {
    const s = new THREE.Shape();
    const pts = [[0, 0.12], [0.35, 0.22], [0.7, 0.28], [1.0, 0.1], [0.86, -0.06], [0.72, 0.0], [0.6, -0.14], [0.44, -0.04], [0.28, -0.16], [0, -0.1]];
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, -y) : s.moveTo(x, -y)));
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  const total = flocks.reduce((n, f) => n + f.count, 0);
  const mat = new THREE.MeshBasicMaterial({ name: 'bat', color: new THREE.Color('#07080c'), side: THREE.DoubleSide });
  const right = new THREE.InstancedMesh(wing, mat, total);
  const left = new THREE.InstancedMesh(wing, mat, total);
  right.frustumCulled = left.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'bats';
  group.add(right, left);

  const bats: { c: THREE.Vector3; r: number; h: number; w: number; ph: number; fl: number; s: number }[] = [];
  for (const f of flocks) {
    const c = new THREE.Vector3(...f.center);
    for (let i = 0; i < f.count; i++) {
      bats.push({ c, r: rr(...(f.radius ?? [14, 60])), h: rr(-(f.rise ?? 22), f.rise ?? 22), w: rr(0.3, 0.7) * (rand() < 0.5 ? -1 : 1), ph: rand() * 6.28, fl: rr(9, 13), s: rr(0.9, 1.5) });
    }
  }

  const d = new THREE.Object3D();
  const nearest = new THREE.Vector3();
  let quiet = 0;
  const m = new THREE.Matrix4();
  const mr = new THREE.Matrix4();
  const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
  return {
    object: group,
    update(dt, time) {
      let best = CHITTER * CHITTER;
      bats.forEach((b, i) => {
        const a = b.ph + time * b.w;
        const x = b.c.x + Math.cos(a) * b.r + Math.sin(time * 0.6 + b.ph) * 6;
        const y = b.c.y + b.h + Math.sin(time * 1.3 + b.ph * 2) * 5;
        const z = b.c.z + Math.sin(a) * b.r * 0.8;
        const vx = -Math.sin(a) * b.w;
        const vz = Math.cos(a) * b.w * 0.8;
        d.position.set(x, y, z);
        const d2 = d.position.distanceToSquared(ctx.player);
        if (d2 < best) {
          best = d2;
          nearest.copy(d.position);
        }
        d.rotation.set(0, Math.atan2(vx, vz), Math.sin(time * 2 + b.ph) * 0.3);
        d.scale.setScalar(b.s);
        d.updateMatrix();
        const flap = Math.sin(time * b.fl + b.ph) * 0.9;
        mr.makeRotationZ(flap);
        m.multiplyMatrices(d.matrix, mr);
        right.setMatrixAt(i, m);
        mr.makeRotationZ(-flap);
        m.multiplyMatrices(d.matrix, mr).multiply(mirror);
        left.setMatrixAt(i, m);
      });
      right.instanceMatrix.needsUpdate = left.instanceMatrix.needsUpdate = true;
      // Now and then, while one is close.
      quiet -= dt;
      if (best < CHITTER * CHITTER && quiet <= 0) {
        ctx.sound('chitter', nearest);
        quiet = range(rand, 1.2, 3.5);
      }
    },
  };
}
