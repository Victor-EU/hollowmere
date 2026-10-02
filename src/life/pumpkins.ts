import * as THREE from 'three';
import type { WorldData } from '../data';
import { range, rng } from '../world/math';
import { EMISSIVE } from '../world/materials';
import type { Textures } from '../world/textures';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

interface Pumpkin {
  base: THREE.Vector3;
  s: number;
  ph: number;
  sp: number;
  yaw: number;
  yawSp: number;
}

/** Ribbed sphere with a stem, carved face glowing from the emissive map. */
function pumpkinGeometry(): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(1, 36, 22);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rib = 1 - 0.07 * Math.pow(Math.abs(Math.sin(a * 5)), 0.6);
    const flat = 1 - 0.12 * Math.pow(Math.abs(y), 3);
    p.setXYZ(i, x * rib * flat, y * 0.8 - (Math.abs(y) > 0.95 ? Math.sign(y) * 0.08 : 0), z * rib * flat);
  }
  g.computeVertexNormals();
  return g;
}

export function makePumpkins(world: WorldData, tex: Textures, viaduct: { a: THREE.Vector3; b: THREE.Vector3 }, ctx: LifeContext): Living {
  const rand = rng(5150);
  const rr = (a: number, b: number) => range(rand, a, b);
  const cfg = world.life.pumpkins;
  const pumpkins: Pumpkin[] = [];
  const add = (x: number, y: number, z: number, s: number) =>
    pumpkins.push({ base: new THREE.Vector3(x, y, z), s, ph: rand() * 6.28, sp: rr(0.4, 0.9), yaw: rand() * 6.28, yawSp: rr(-0.25, 0.25) });
  for (const c of cfg.clouds) {
    for (let i = 0; i < c.count; i++) add(rr(c.min[0], c.max[0]), rr(c.min[1], c.max[1]), rr(c.min[2], c.max[2]), rr(c.scale[0], c.scale[1]));
  }
  add(...cfg.giant.at, cfg.giant.scale);
  const v = cfg.viaduct;
  for (let i = 0; i < v.count; i++) {
    const p = viaduct.a.clone().lerp(viaduct.b, rand());
    add(p.x + rr(-v.spread, v.spread), p.y + rr(v.rise[0], v.rise[1]), p.z + rr(-v.spread, v.spread), rr(v.scale[0], v.scale[1]));
  }

  const group = new THREE.Group();
  group.name = 'pumpkins';
  const N = pumpkins.length;
  const mat = new THREE.MeshStandardMaterial({
    name: 'pumpkin',
    map: tex.pumpkin,
    emissiveMap: tex.pumpkinGlow,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: EMISSIVE.pumpkinFace,
    roughness: 0.55,
  });
  const body = new THREE.InstancedMesh(pumpkinGeometry(), mat, N);
  const stemG = new THREE.CylinderGeometry(0.08, 0.13, 0.42, 6);
  stemG.translate(0, 0.93, 0);
  const stem = new THREE.InstancedMesh(stemG, new THREE.MeshStandardMaterial({ name: 'stem', color: new THREE.Color('#3b3a1a'), roughness: 0.8 }), N);
  body.frustumCulled = stem.frustumCulled = false;
  const glow = new Pool(N);
  group.add(body, stem, glow.points);

  const d = new THREE.Object3D();
  return {
    object: group,
    update(_dt, time) {
      pumpkins.forEach((pk, i) => {
        const bob = ctx.reduceMotion ? 0 : Math.sin(time * pk.sp + pk.ph) * 0.8;
        d.position.set(pk.base.x, pk.base.y + bob, pk.base.z);
        d.rotation.set(Math.sin(time * 0.5 + pk.ph) * 0.08, pk.yaw + time * pk.yawSp, 0);
        d.scale.setScalar(pk.s);
        d.updateMatrix();
        body.setMatrixAt(i, d.matrix);
        stem.setMatrixAt(i, d.matrix);
        glow.pos.set([d.position.x, d.position.y, d.position.z], i * 3);
        const fl = 0.85 + 0.15 * Math.sin(time * 9 + pk.ph * 3) * Math.sin(time * 5.3 + pk.ph);
        glow.col.set([1.5 * fl, 0.6 * fl, 0.14 * fl, 0.45], i * 4);
        glow.size[i] = pk.s * 4.6;
      });
      body.instanceMatrix.needsUpdate = stem.instanceMatrix.needsUpdate = true;
      glow.flush();
    },
  };
}
