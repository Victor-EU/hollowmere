import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WitchData } from '../data';
import { insideColliders } from '../flight/flight';
import type { Colliders } from '../world/castle';
import type { Heights } from '../world/heights';
import { clamp, dampK, lerp, range, rng, smoothstep } from '../world/math';
import { cat } from './beasts';
import { NECK, pumpkin, witchHead } from './guests';
import { chain, cone, Creatures, ellipsoid, J, limb, Rig, rigMaterial } from './rig';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

type V3 = [number, number, number];
const mirror = (p: V3, s: number): V3 => [p[0] * s, p[1], p[2]];

/** How hard she can turn, radians a second: a circle of about 38 m radius at cruising speed. */
const TURN = 0.45;
/** The moon crossing is measured in these from its middle; her speed over the moon itself, so it frames her a few seconds. */
const HALF = 50;
const CROSS = 10;
/** Past this she's too small and fogged to notice. */
const FAR = 900;
/** Above every mountain: the tallest reach about 375 m (world/heights.ts). */
const PEAKS = 380;
/** Within this she turns her head to watch you, and waves as you come. */
const NOTICE = 60;
/** She keeps at least this far from you. */
const SHY = 40;

// Model space, human scale: she sits on the handle at the origin, facing +z.
const LEAN = 0.45;
const SHOULDER = 0.19;
/** The bristles' end, where the sparks come off; the hook the lantern hangs from, and how far below it. */
const TAIL = new THREE.Vector3(0, -0.03, -1.85);
const HOOK: V3 = [0, -0.03, 1.08];
const DROP = 0.31;

/** `m` about the point `p`. */
const about = (p: V3, m: THREE.Matrix4) => new THREE.Matrix4().makeTranslation(...p).multiply(m).multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));

/**
 * A witch astride her broom, leaning into the wind: robe, striped stockings and pointed boots, the
 * hall witches' head and hat, a cape streaming behind on the tail joint. A jack-o'-lantern swings
 * from the handle (back-left limb channel) and a black cat rides on the bristles. Her left arm
 * (front-left) lets go of the handle to wave.
 */
function broomWitch(): THREE.BufferGeometry {
  const r = new Rig();
  const robe = '#231a2b';
  const skin = '#98a986';
  const boot = '#121014';
  const wood = '#4a3220';
  const stocking = (p: THREE.Vector3) => (Math.floor((p.y + 1) * 22) % 2 ? '#c2551d' : '#17121a');
  const lean = about([0, 0.06, 0], new THREE.Matrix4().makeRotationX(LEAN));
  const leant = (p: V3) => new THREE.Vector3(...p).applyMatrix4(lean).toArray() as V3;

  // The broom: a crooked handle, the binding, a flared bundle of twigs.
  r.add(limb([0, -0.01, -1.0], [0, -0.01, 1.22], 0.026, 0.022, 6), J.body, [0, 0, 0], wood);
  r.add(chain([[0, -0.01, 1.22], [0, 0.03, 1.33], [0, 0.1, 1.38]], [0.022, 0.022, 0.026], 5), J.body, [0, 0, 0], wood);
  r.add(limb([0, -0.01, -0.95], [0, -0.01, -1.06], 0.055, 0.062, 8), J.body, [0, 0, 0], '#2b1f15');
  r.add(limb([0, -0.01, -1.02], [0, -0.03, -1.8], 0.055, 0.19, 10), J.body, [0, 0, 0], (p: THREE.Vector3) => (p.z < -1.5 ? '#9a7b45' : '#7d6136'));
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3;
    r.add(cone([Math.cos(a) * 0.045, -0.01 + Math.sin(a) * 0.045, -1.05], [Math.cos(a) * 0.24, -0.03 + Math.sin(a) * 0.21, -1.86 - (k % 3) * 0.05], 0.03, 4), J.body, [0, 0, 0], k % 2 ? '#a88a52' : '#6b5230');
  }

  // Seat, skirts over the thighs, and the hem trailing behind on the tail joint with the cape.
  r.add(ellipsoid([0, 0.07, -0.02], [0.19, 0.1, 0.17], 0, 10), J.body, [0, 0, 0], robe);
  for (const s of [1, -1]) r.add(ellipsoid(mirror([0.13, -0.03, 0.12], s), [0.09, 0.15, 0.25], [0.35, 0, s * -0.25], 8), J.body, [0, 0, 0], robe);
  r.add(ellipsoid([0, 0.0, -0.27], [0.17, 0.06, 0.24], -0.15, 8), J.tail, [0, 0.05, -0.08], robe);

  // Legs: knees forward, stockings, pointed boots.
  for (const s of [1, -1]) {
    const knee = mirror([0.13, -0.08, 0.36], s);
    const ankle = mirror([0.12, -0.44, 0.28], s);
    r.add(limb(mirror([0.1, 0.04, 0.02], s), knee, 0.085, 0.065, 7), J.body, [0, 0, 0], robe);
    r.add(ellipsoid(knee, [0.055, 0.055, 0.055], 0, 6), J.body, [0, 0, 0], stocking);
    r.add(limb(knee, ankle, 0.05, 0.038, 7), J.body, [0, 0, 0], stocking);
    r.add(ellipsoid(mirror([0.12, -0.47, 0.32], s), [0.045, 0.045, 0.085], 0.2, 6), J.body, [0, 0, 0], boot);
    r.add(chain([mirror([0.12, -0.48, 0.38], s), mirror([0.12, -0.47, 0.46], s), mirror([0.12, -0.42, 0.5], s)], [0.035, 0.02, 0.006], 5), J.body, [0, 0, 0], boot);
  }

  // Body leant forward over the handle; a purple sash; the head turned back up to see ahead, hair streaming.
  r.moved(lean, () => {
    r.add(limb([0, 0.06, 0], [0, 0.57, 0], 0.2, 0.15, 10), J.body, [0, 0, 0], robe);
    r.add(ellipsoid([0, 0.55, 0], [0.21, 0.075, 0.12], 0, 10), J.body, [0, 0, 0], robe);
    r.add(limb([0, 0.2, 0], [0, 0.25, 0], 0.192, 0.188, 10), J.body, [0, 0, 0], '#5b2a6e');
    r.moved(about(NECK, new THREE.Matrix4().makeRotationX(-LEAN * 0.85)), () => {
      witchHead(r, 0);
      r.add(ellipsoid([0, 0.72, -0.16], [0.1, 0.07, 0.15], -0.5, 8), J.head, NECK, '#2b2a2f');
    });
  });
  // The cape, streaming back from her shoulders on the tail joint.
  const nape = leant([0, 0.55, -0.1]);
  r.add(ellipsoid([0, nape[1] - 0.13, nape[2] - 0.44], [0.24, 0.03, 0.46], -0.27, 10), J.tail, nape, '#1a1222');
  r.add(ellipsoid([0, nape[1] - 0.2, nape[2] - 0.72], [0.3, 0.025, 0.24], -0.2, 10), J.tail, nape, '#1a1222');

  // Arms reaching down to the handle: the right hand ahead of the left.
  for (const s of [1, -1]) {
    const sh = leant(mirror([SHOULDER, 0.55, 0], s));
    const elbow = mirror([0.23, 0.27, 0.42], s);
    const hand = mirror([0.065, 0.05, s > 0 ? 0.6 : 0.74], s);
    const joint = s > 0 ? J.fl : J.fr;
    r.add(ellipsoid(sh, [0.06, 0.06, 0.06], 0, 6), joint, sh, robe);
    r.add(limb(sh, elbow, 0.056, 0.047, 7), joint, sh, robe);
    r.add(ellipsoid(elbow, [0.047, 0.047, 0.047], 0, 6), joint, sh, robe);
    r.add(limb(elbow, [hand[0], hand[1] + 0.02, hand[2] - 0.05], 0.047, 0.075, 7), joint, sh, robe);
    r.add(ellipsoid(hand, [0.034, 0.03, 0.045], 0, 6), joint, sh, skin);
  }

  // The lantern on its cord.
  const lamp: V3 = [HOOK[0], HOOK[1] - DROP, HOOK[2]];
  r.add(limb(HOOK, [lamp[0], lamp[1] + 0.07, lamp[2]], 0.006, 0.006, 3), J.bl, HOOK, '#1a1410');
  pumpkin(r, lamp, 0.085, J.bl, HOOK, 1.4);

  // The cat, sitting on the handle behind her. Its legs stay on the body (her arms use those
  // channels); its head turns with hers and its tail swings with her cape.
  const passenger = cat().geometry;
  const at = new THREE.Matrix4().makeTranslation(0, 0.01, -0.62);
  passenger.applyMatrix4(at);
  const pivot = passenger.getAttribute('aPivot');
  const joint = passenger.getAttribute('aJoint');
  const p = new THREE.Vector3();
  for (let i = 0; i < pivot.count; i++) {
    p.fromBufferAttribute(pivot, i).applyMatrix4(at);
    pivot.setXYZ(i, p.x, p.y, p.z);
    if (joint.getX(i) >= J.fl && joint.getX(i) <= J.br) joint.setX(i, J.body);
  }
  const rider = r.build();
  const g = mergeGeometries([rider, passenger], false);
  if (!g) throw new Error('witch: the cat could not be merged');
  rider.dispose();
  passenger.dispose();
  g.computeBoundingSphere();
  return g;
}

/**
 * The witch on her broom (design doc §10). She roams the sky round you, out of the castle's
 * airspace, banking through her turns with sparks streaming off the bristles. Every couple of
 * minutes, while you're facing the moon, she crosses it: painting B's silhouette. Within 60 m she
 * turns her head to watch you and waves; she never comes nearer than 40 m.
 */
export function makeWitch(cfg: WitchData, heights: Heights, colliders: Colliders, moon: THREE.Vector3, camera: THREE.Camera, ctx: LifeContext): Living {
  const rand = rng(1031);
  const rr = (a: number, b: number) => range(rand, a, b);
  const ko = cfg.keepOut;
  const calm = ctx.reduceMotion;
  const group = new THREE.Group();
  group.name = 'witch';
  const mesh = new Creatures('witch', broomWitch(), rigMaterial('witch'), 1);
  const sparks = new Pool(200);
  const lamp = new Pool(1);
  group.add(mesh.mesh, sparks.points, lamp.points);

  const pos = camera.position.clone();
  const goal = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const toMoon = new THREE.Vector3();
  const side = new THREE.Vector3();

  /** Out of the castle's airspace. */
  const clear = (p: THREE.Vector3) => p.y > ko.below || Math.hypot(p.x - ko.center[0], p.z - ko.center[1]) > ko.radius;
  /** Somewhere she may fly: within bounds, over the ground, out of the castle's airspace. */
  const free = (p: THREE.Vector3, margin = 40) =>
    Math.hypot(p.x - ko.center[0], p.z - ko.center[1]) < cfg.within && clear(p) && p.y > heights.ground(p.x, p.z) + margin;

  /** A new place to make for, somewhere round you; further from `away` than she is, if given. */
  const pick = (away?: THREE.Vector3) => {
    const c = camera.position;
    for (let k = 0; k < 30; k++) {
      const a = rand() * Math.PI * 2;
      const d = rr(...cfg.ring);
      t1.set(c.x + Math.cos(a) * d, 0, c.z + Math.sin(a) * d);
      t1.y = Math.max(rr(...cfg.height), heights.ground(t1.x, t1.z) + 50);
      if (!free(t1) || t1.distanceTo(pos) < 100) continue;
      if (away && t1.distanceTo(away) < pos.distanceTo(away)) continue;
      return goal.copy(t1);
    }
    // Nowhere round you (you're deep in the castle, or out at the edge): on round its airspace.
    const a = Math.atan2(pos.z - ko.center[1], pos.x - ko.center[0]) + rr(0.6, 1.2);
    const d = ko.radius + 70;
    t1.set(ko.center[0] + Math.cos(a) * d, 0, ko.center[1] + Math.sin(a) * d);
    t1.y = Math.max(rr(...cfg.height), heights.ground(t1.x, t1.z) + 50);
    return goal.copy(t1);
  };

  /** Somewhere out of the shot, behind the camera. */
  const offstage = () => {
    camera.getWorldDirection(t2).setY(0).normalize();
    for (let k = 0; k < 12; k++) {
      t1.copy(camera.position).addScaledVector(t2, -rr(120, 200)).add(ahead.set(-t2.z, 0, t2.x).multiplyScalar(rr(-80, 80)));
      t1.y = Math.max(rr(...cfg.height), heights.ground(t1.x, t1.z) + 50);
      if (free(t1)) return goal.copy(t1);
    }
    return pick();
  };

  /** Her heading for `to`: straight, or bent round the castle's airspace when the line would cross it. */
  const course = (to: THREE.Vector3) => {
    aim.copy(to);
    if (pos.y > ko.below && to.y > ko.below) return aim;
    const [cx, cz] = ko.center;
    const dx = to.x - pos.x;
    const dz = to.z - pos.z;
    const len2 = dx * dx + dz * dz || 1;
    const u = clamp(((cx - pos.x) * dx + (cz - pos.z) * dz) / len2, 0, 1);
    const qx = pos.x + dx * u - cx;
    const qz = pos.z + dz * u - cz;
    const q = Math.hypot(qx, qz);
    const R = ko.radius + 30;
    if (q > R) return aim;
    const [nx, nz] = q > 1e-3 ? [qx / q, qz / q] : [-dz / Math.sqrt(len2), dx / Math.sqrt(len2)];
    return aim.set(cx + nx * (R + 40), Math.max(to.y, pos.y), cz + nz * (R + 40));
  };

  // What the camera sees, to stage the moon crossing out of sight.
  const frustum = new THREE.Frustum();
  const sphere = new THREE.Sphere();
  const pm = new THREE.Matrix4();
  const look = () => {
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  };
  const seen = (p: THREE.Vector3) => p.distanceTo(camera.position) < FAR && frustum.intersectsSphere(sphere.set(p, 4 * cfg.scale));
  /** The moon in plain sight from `c`: no tower, wall or mountain in front of it. Marches out until the ray clears the peaks. */
  const moonInSight = (c: THREE.Vector3) => {
    for (let d = 2; d < 2000; d += 4) {
      t2.copy(c).addScaledVector(toMoon, d);
      if (t2.y > PEAKS) return true;
      if (insideColliders(colliders, t2) || t2.y < heights.ground(t2.x, t2.z)) return false;
    }
    return true;
  };

  // The moon crossing: a level line `d` metres out from the camera toward the moon, square to it,
  // in halves of HALF from the middle (u = 0 is dead on the moon).
  let plan: { d: number; dir: number } | null = null;
  /** A point on the crossing. Sets `side`, the way along it. */
  const line = (u: number, out: THREE.Vector3) => {
    const c = camera.position;
    toMoon.subVectors(moon, c).normalize();
    side.set(-toMoon.z, 0, toMoon.x).normalize().multiplyScalar(plan!.dir);
    return out.copy(c).addScaledVector(toMoon, plan!.d).addScaledVector(side, u * HALF);
  };
  /**
   * When the moon's on screen and she isn't: a crossing in plain sight of the camera that starts
   * just out of frame, stays out of the castle's airspace all the way and over the ground wherever
   * you'd see it. Returns where it starts, or null.
   */
  const planMoon = () => {
    look();
    toMoon.subVectors(moon, camera.position).normalize();
    t1.copy(camera.position).addScaledVector(toMoon, 100).project(camera);
    if (Math.abs(t1.x) > 0.75 || Math.abs(t1.y) > 0.75 || t1.z > 1) return null;
    // In sight now, and from where you'll be while she crosses (not about to fly into the hall).
    if (!moonInSight(camera.position) || ![3, 6, 9].every((s) => moonInSight(ctx.ahead(s, ahead)))) return null;
    // She's in the shot herself: out of it first.
    if (seen(pos)) {
      offstage();
      return null;
    }
    // Middling distances first: near enough that her silhouette fills a good part of the moon.
    const [near, far] = cfg.moon.distance;
    const mid = (near + far) / 2;
    const ds: number[] = [];
    for (let d = near; d <= far; d += 25) ds.push(d);
    ds.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    for (const d of ds) {
      plan = { d, dir: rand() < 0.5 ? 1 : -1 };
      for (let flip = 0; flip < 2; flip++, plan.dir *= -1) {
        let u0 = -1;
        while (u0 > -8 && seen(line(u0, t1))) u0 -= 0.25;
        if (u0 <= -8) continue;
        let ok = true;
        for (let u = u0; ok && u <= -u0; u += 0.25) {
          line(u, t1);
          ok = Math.abs(u) > 2.5 ? clear(t1) : free(t1, 30);
        }
        if (ok) return u0;
      }
    }
    plan = null;
    return null;
  };

  pos.copy(pick());
  pick();
  let mode: 'roam' | 'cross' = 'roam';
  let modeT = 0;
  let u = 0;
  // The first crossing comes as soon as the moon's in view and she can be staged for it.
  let moonIn = rr(3, 5);
  let yaw = Math.atan2(goal.x - pos.x, goal.z - pos.z);
  let turn = 0;
  let climb = 0;
  let speed = cfg.speed;
  let roll = 0;
  let shyT = 0;
  let headP = 0;
  let headY = 0;
  let wave = 0;
  let waveCool = 0;
  let sparkDebt = 0;
  const prevTail = new THREE.Vector3().copy(pos);
  const tail = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qi = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const s = new THREE.Vector3().setScalar(cfg.scale);
  const shown = new THREE.Vector3();
  const local = new THREE.Vector3();
  const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

  const toRoam = () => {
    mode = 'roam';
    modeT = 0;
    plan = null;
    moonIn = rr(...cfg.moon.every);
    pick();
  };

  return {
    object: group,
    cull(cam) {
      group.visible = pos.distanceTo(cam.position) < FAR;
    },
    update(dt, time) {
      modeT += dt;
      shyT -= dt;

      if (mode === 'roam') {
        // Moved on round you, or too near you: somewhere new.
        if (pos.distanceTo(goal) < 45 || goal.distanceTo(camera.position) > cfg.ring[1] + 150 || modeT > 40) {
          pick();
          modeT = 0;
        }
        if (pos.distanceTo(ctx.player) < SHY && shyT <= 0) {
          pick(ctx.player);
          shyT = 4;
        }
        if ((moonIn -= dt) <= 0) {
          const u0 = planMoon();
          if (u0 === null) moonIn = 2;
          else {
            // Out of sight, to just out of frame on the crossing.
            mode = 'cross';
            u = u0;
            pos.copy(line(u, t1));
            prevTail.copy(pos);
          }
        }
      }

      if (mode === 'cross') {
        // Along the line, which holds still against the moon however the camera moves: swooping in
        // from the edge of the frame, slowing over the moon, and off until she's out of sight again.
        speed = lerp(CROSS, cfg.speed * 3.5, smoothstep(0.35, 1.6, Math.abs(u)));
        u += (speed * dt) / HALF;
        pos.copy(line(u, t1));
        yaw = Math.atan2(side.x, side.z);
        turn = 0;
        climb = 0;
        if (u > 1) {
          look();
          if (!seen(pos) || u > 8) toRoam();
        }
      } else {
        course(goal);
        // Over the ground: what's ahead, as well as below.
        const front = heights.ground(pos.x + Math.sin(yaw) * 60, pos.z + Math.cos(yaw) * 60);
        const ty = Math.max(aim.y, front + 45, heights.ground(pos.x, pos.z) + 40);
        const err = wrap(Math.atan2(aim.x - pos.x, aim.z - pos.z) - yaw);
        turn = lerp(turn, clamp(err * 0.8, -TURN, TURN), dampK(1.5, dt));
        yaw += turn * dt;
        climb = lerp(climb, clamp((ty - pos.y) * 0.25, -5, 4), dampK(1, dt));
        speed = lerp(speed, cfg.speed, dampK(0.6, dt));
        pos.x += Math.sin(yaw) * speed * dt;
        pos.z += Math.cos(yaw) * speed * dt;
        pos.y += climb * dt;
      }

      // Banked into the turn, nose up to climb, and a lazy bob.
      roll = lerp(roll, clamp((-turn * speed) / 9.8, -0.6, 0.6) * (calm ? 0.5 : 1), dampK(2, dt));
      const pitch = -Math.atan2(climb, speed) * 0.8;
      shown.copy(pos);
      if (!calm) shown.y += Math.sin(time * 1.1) * 0.5 + Math.sin(time * 2.3) * 0.2;
      q.setFromEuler(e.set(pitch, yaw, roll));
      m.compose(shown, q, s);

      // Watching you as she passes, and a wave as you come.
      const near = 1 - smoothstep(NOTICE * 0.6, NOTICE, shown.distanceTo(ctx.player));
      local.subVectors(ctx.player, shown).applyQuaternion(qi.copy(q).invert());
      headY = lerp(headY, clamp(Math.atan2(local.x, local.z), -1.3, 1.3) * near, dampK(3, dt));
      headP = lerp(headP, clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.7, 0.6) * near, dampK(3, dt));
      waveCool -= dt;
      if (near > 0.4 && waveCool <= 0) {
        wave = 2.6;
        waveCool = 12;
      }
      wave = Math.max(0, wave - dt);
      const raise = clamp(Math.min(2.6 - wave, wave) / 0.4, 0, 1);
      const arm = raise * (-2.3 + (calm ? 0 : Math.sin(time * 9) * 0.35));

      const k = calm ? 0.3 : 1;
      const capeP = 0.12 + (Math.sin(time * 9.5) * 0.1 + Math.sin(time * 15.3) * 0.04) * k;
      const capeY = clamp(-turn * 0.6, -0.3, 0.3) + Math.sin(time * 6.1) * 0.08 * k;
      const swing = -pitch + Math.sin(time * 2.2) * 0.12 * k;
      mesh.set(0, m, [headP, headY, capeP, capeY], [arm, 0, swing, 0], [1, 1 + near * 0.6, 1, 1]);
      mesh.flush();

      // Sparks off the bristles, left hanging in the air behind her; gold, cooling to green.
      tail.copy(TAIL).applyMatrix4(m);
      const size = cfg.scale / 2.5;
      sparkDebt += dt * (calm ? 20 : 60);
      const n = Math.floor(sparkDebt);
      sparkDebt -= n;
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / n;
        const j = 0.25 * size;
        sparks.emit(lerp(prevTail.x, tail.x, f) + rr(-j, j), lerp(prevTail.y, tail.y, f) + rr(-j, j), lerp(prevTail.z, tail.z, f) + rr(-j, j), rr(-0.6, 0.6), rr(-0.8, 0.2), rr(-0.6, 0.6), rr(0.9, 1.7));
      }
      prevTail.copy(tail);
      sparks.update(dt, 0.8, (i, t, p) => {
        const a = (1 - t) * (calm ? 0.8 : 0.65 + 0.35 * Math.sin(i * 7.3 + t * 40));
        p.col.set([lerp(1, 0.55, t), lerp(0.78, 1, t), lerp(0.4, 0.55, t), a], i * 4);
        p.size[i] = lerp(0.55, 0.15, t) * (0.7 + 0.6 * ((i * 0.618) % 1)) * size;
      });

      // The lantern's glow, where it hangs.
      t1.set(HOOK[0], HOOK[1] - DROP * Math.cos(swing), HOOK[2] - DROP * Math.sin(swing)).applyMatrix4(m);
      lamp.pos.set([t1.x, t1.y, t1.z], 0);
      lamp.col.set([1, 0.55, 0.2, 0.8 + (calm ? 0 : Math.sin(time * 13) * 0.08)], 0);
      lamp.size[0] = 2.4 * size;
      lamp.flush();
    },
  };
}
