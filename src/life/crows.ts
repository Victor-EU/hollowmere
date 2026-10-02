import * as THREE from 'three';
import type { Vec2 } from '../data';
import type { Heights } from '../world/heights';
import { clamp, dampK, lerp, range, rng } from '../world/math';
import { crow } from './beasts';
import { Creatures, rigMaterial } from './rig';
import type { LifeContext, Living } from './types';

/** Caws carry this far; the event player drops anything beyond its own range anyway. */
const HEARD = 170;
/** A crow takes off when you come this near, circles, and lands again (design doc §10). */
const SKITTISH = 8;
/** Raven-sized, so they read from the air. */
const SIZE = 1.9;

interface Crow {
  /** Where it lands: a perch (fixed) or a patch of ground (anywhere within `r`). */
  home: THREE.Vector3;
  r: number;
  pos: THREE.Vector3;
  yaw: number;
  state: 'sit' | 'fly' | 'land';
  timer: number;
  /** Circling: centre, radius and angular speed. */
  orbit: { c: THREE.Vector3; r: number; w: number; a: number };
  /** Hop and peck on the ground: seconds to the next peck and hop, and how far through a hop (1 when still). */
  peck: number;
  hop: number;
  hopT: number;
  hopFrom: THREE.Vector3;
  hopTo: THREE.Vector3;
  head: number;
  flap: number;
}

/**
 * Crows on the bare trees by the gate and the boathouse ridge, and flocks pecking about on the
 * ground below the gate. Pass within 8 m and they go up, caw, circle once or twice and settle
 * again. Now and then one within earshot caws anyway.
 */
export function makeCrows(perches: THREE.Vector3[], ground: { center: Vec2; radius: number; count: number }[], every: [number, number], heights: Heights, ctx: LifeContext): Living {
  const rand = rng(613);
  const rr = (a: number, b: number) => range(rand, a, b);
  const make = (home: THREE.Vector3, r: number): Crow => ({
    home,
    r,
    pos: home.clone(),
    yaw: rand() * Math.PI * 2,
    state: 'sit',
    timer: 0,
    orbit: { c: new THREE.Vector3(), r: 0, w: 0, a: 0 },
    peck: rr(0, 3),
    hop: rr(1, 6),
    hopT: 1,
    hopFrom: new THREE.Vector3(),
    hopTo: new THREE.Vector3(),
    head: 0,
    flap: rand() * 6,
  });
  const crows: Crow[] = perches.map((p) => make(p.clone(), 0));
  for (const g of ground) {
    for (let i = 0; i < g.count; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * g.radius;
      const x = g.center[0] + Math.cos(a) * d;
      const z = g.center[1] + Math.sin(a) * d;
      const c = make(new THREE.Vector3(g.center[0], 0, g.center[1]), g.radius);
      c.pos.set(x, heights.ground(x, z), z);
      crows.push(c);
    }
  }
  const mesh = new Creatures('crows', crow().geometry, rigMaterial('crow'), crows.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const s = new THREE.Vector3(SIZE, SIZE, SIZE);
  const to = new THREE.Vector3();
  let wait = range(rand, ...every) * 0.5;
  let cawGap = 0;

  /** Somewhere to come down: the perch itself, or a fresh spot on the patch. */
  const landing = (c: Crow) => {
    if (!c.r) return c.home.clone();
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * c.r;
    const x = c.home.x + Math.cos(a) * d;
    const z = c.home.z + Math.sin(a) * d;
    return new THREE.Vector3(x, heights.ground(x, z), z);
  };

  return {
    object: mesh.mesh,
    // Crows are specks past a few hundred metres.
    cull(cam) {
      mesh.mesh.visible = crows.some((c) => c.pos.distanceTo(cam.position) < 380);
    },
    update(dt) {
      cawGap -= dt;
      crows.forEach((c, i) => {
        let flying = false;
        let pitch = 0;
        if (c.state === 'sit') {
          if (c.pos.distanceTo(ctx.player) < SKITTISH) {
            // Up and away, circling over the spot.
            c.state = 'fly';
            c.timer = rr(5, 9);
            const base = c.r ? c.pos : c.home;
            c.orbit = { c: base.clone().add(new THREE.Vector3(rr(-3, 3), rr(7, 12), rr(-3, 3))), r: rr(5, 9), w: rr(0.7, 1.1) * (rand() < 0.5 ? -1 : 1), a: Math.atan2(c.pos.z - base.z, c.pos.x - base.x) };
            if (cawGap <= 0) {
              ctx.sound('caw', c.pos);
              cawGap = 1.5;
            }
          } else if (c.r) {
            // On the ground: peck, and hop now and then.
            c.peck -= dt;
            if (c.peck < 0) c.peck = rr(0.8, 3);
            c.head = lerp(c.head, c.peck < 0.25 ? 1.2 : 0.1, dampK(14, dt));
            c.hop -= dt;
            if (c.hop < 0) {
              c.hop = rr(2, 7);
              c.hopFrom.copy(c.pos);
              const a = rand() * Math.PI * 2;
              const nx = clamp(c.pos.x + Math.cos(a) * 0.9, c.home.x - c.r, c.home.x + c.r);
              const nz = clamp(c.pos.z + Math.sin(a) * 0.9, c.home.z - c.r, c.home.z + c.r);
              c.hopTo.set(nx, heights.ground(nx, nz), nz);
              c.yaw = Math.atan2(nx - c.pos.x, nz - c.pos.z);
              c.hopT = 0;
            }
            if (c.hopT < 1) {
              c.hopT = Math.min(1, c.hopT + dt / 0.3);
              c.pos.lerpVectors(c.hopFrom, c.hopTo, c.hopT);
              c.pos.y += Math.sin(c.hopT * Math.PI) * 0.25;
            }
          } else {
            c.head = lerp(c.head, Math.sin(c.peck += dt * 0.4) * 0.3, dampK(3, dt));
          }
        } else if (c.state === 'fly') {
          flying = true;
          const o = c.orbit;
          o.a += (o.w * dt * 6) / o.r;
          to.set(o.c.x + Math.cos(o.a) * o.r, o.c.y + Math.sin(o.a * 0.5) * 1.5, o.c.z + Math.sin(o.a) * o.r);
          c.pos.lerp(to, dampK(1.5, dt));
          c.yaw = Math.atan2(-Math.sin(o.a) * Math.sign(o.w), Math.cos(o.a) * Math.sign(o.w));
          if ((c.timer -= dt) <= 0 && c.pos.distanceTo(ctx.player) > SKITTISH * 2) {
            c.state = 'land';
            c.hopTo.copy(landing(c));
          }
        } else {
          // Gliding down to land.
          flying = true;
          to.subVectors(c.hopTo, c.pos);
          const d = to.length();
          c.yaw = Math.atan2(to.x, to.z);
          pitch = clamp(-to.y / Math.max(d, 0.1), -0.5, 0.6) * 0.6;
          c.pos.addScaledVector(to.normalize(), Math.min(d, 6 * dt));
          if (d < 0.15) {
            c.state = 'sit';
            c.hop = rr(2, 6);
            c.hopT = 1;
          }
        }
        c.flap += dt * (flying ? 7 : 0);
        const wing = flying ? (c.state === 'land' ? 0.25 + Math.sin(c.flap) * 0.25 : Math.sin(c.flap) * 0.85 + 0.1) : -0.15;
        m.compose(c.pos, q.setFromEuler(e.set(pitch, c.yaw, 0)), s);
        mesh.set(i, m, [flying ? -0.1 : c.head, 0, 0, 0], [wing, wing, 0, 0], [1, 0, flying ? 1 : 0.35, 0]);
      });
      mesh.flush();
      // Now and then one within earshot caws anyway.
      wait -= dt;
      if (wait > 0) return;
      wait = range(rand, ...every);
      const near = crows.filter((c) => c.pos.distanceTo(ctx.player) < HEARD);
      if (near.length) ctx.sound('caw', near[Math.floor(rand() * near.length)].pos);
    },
  };
}
