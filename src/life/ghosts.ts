import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GhostGroup, GhostIdle, GhostLook } from '../data';
import { makeGhost, type Ghost } from '../flight/ghost';
import type { Castle } from '../world/castle';
import { angLerp, clamp, dampK, lerp, range, rng } from '../world/math';
import type { Materials } from '../world/materials';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

/** Drifting to an idle spot, then up a stair or back to the loop, metres per second. */
const GO = 2.4;
const DRIFT = 1.1;
/** Nods: within this range, at most one at a time, each ghost at most this often. */
const NOD_RANGE = 10;
const NOD_TIME = 2.6;
const NOD_COOL = 25;
const NOD_GAP = 6;
/** Making way: how far to the side of the player's line a hall ghost wants to be. */
const CLEAR = 6;

type State = 'loop' | 'pause' | 'go' | 'linger' | 'back';

interface Npc {
  ghost: Ghost;
  home: THREE.Vector3;
  r: number;
  y: number;
  sp: number;
  ph: number;
  /** Angle round the home point; frozen while away on an idle. */
  a: number;
  idles: GhostIdle[];
  makeWay: boolean;
  state: State;
  timer: number;
  idle: GhostIdle | null;
  leg: number;
  /** Where it is heading; moves at a set speed. The body eases after it. */
  target: THREE.Vector3;
  pos: THREE.Vector3;
  last: THREE.Vector3;
  yaw: number;
  /** Heading when it stopped, to look about from. */
  base: number;
  /** Seconds into a nod, or -1. */
  nod: number;
  cool: number;
  bob: number;
  push: THREE.Vector3;
  /** Accessory animation. */
  extra?: (time: number, speed: number) => void;
}

/** A tall hat with a drooping tip and a wide brim, sitting on the dome of the head. */
function hatGeometry(): THREE.BufferGeometry {
  const brim = new THREE.CylinderGeometry(0.6, 0.62, 0.05, 20);
  brim.translate(0, 0.9, 0);
  const cone = new THREE.ConeGeometry(0.34, 1.05, 14, 6);
  cone.translate(0, 0.525, 0);
  const p = cone.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(p.getY(i) / 1.05, 2.2) * 0.3);
  cone.translate(0, 0.92, 0);
  const g = mergeGeometries([brim.toNonIndexed(), cone.toNonIndexed()])!;
  g.computeVertexNormals();
  return g;
}

/** A small iron lantern: caps, corner posts and a ring to hang from. Centre at the origin. */
function lanternGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.BoxGeometry(0.32, 0.06, 0.32).translate(0, 0.2, 0),
    new THREE.ConeGeometry(0.2, 0.14, 4).rotateY(Math.PI / 4).translate(0, 0.3, 0),
    new THREE.BoxGeometry(0.28, 0.05, 0.28).translate(0, -0.2, 0),
    ...[-1, 1].flatMap((x) => [-1, 1].map((z) => new THREE.BoxGeometry(0.03, 0.4, 0.03).translate(x * 0.13, 0, z * 0.13))),
    new THREE.TorusGeometry(0.07, 0.015, 4, 10).translate(0, 0.43, 0),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
}

/** Iron links hanging from the top, each turned a quarter from the last, with a weight at the end. */
function chainGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const link = new THREE.TorusGeometry(0.075, 0.022, 4, 10);
    link.scale(1, 1.35, 1);
    if (k % 2) link.rotateY(Math.PI / 2);
    parts.push(link.translate(0, -k * 0.15, 0).toNonIndexed());
  }
  parts.push(new THREE.SphereGeometry(0.12, 10, 8).translate(0, -7 * 0.15 + 0.02, 0).toNonIndexed());
  return mergeGeometries(parts)!;
}

/**
 * Wandering ghosts. Each loops slowly round its home point and now and then does something else:
 * stops and sways, or drifts off to an idle spot from data/world.json (peering through a hall
 * window, over a parapet, up the gate stairs) and lingers there before drifting back. Come within
 * 10 m and one turns to you and nods, with a faint sigh. The two in the hall drift apart to let
 * you through. Each wears or carries something (a hat, a lantern, a chain, a long skirt).
 */
export function makeGhosts(
  groups: GhostGroup[],
  anchors: Record<'gate' | 'hall' | 'pier', THREE.Vector3>,
  hall: Castle['hall'],
  M: Materials,
  ctx: LifeContext,
): Living {
  const rand = rng(808);
  const rr = (a: number, b: number) => range(rand, a, b);
  const group = new THREE.Group();
  group.name = 'ghosts';
  const npcs: Npc[] = [];

  let hat: THREE.Mesh | null = null;
  let chain: THREE.Mesh | null = null;
  let cage: THREE.Mesh | null = null;
  const lanterns: THREE.Object3D[] = [];
  const dress = (n: Npc, look: GhostLook) => {
    const g = n.ghost.group;
    if (look === 'hat') {
      hat ??= new THREE.Mesh(hatGeometry(), new THREE.MeshStandardMaterial({ name: 'ghost-hat', color: new THREE.Color('#17151c'), roughness: 0.85 }));
      const h = hat.clone();
      h.name = 'ghost-hat';
      h.rotation.z = -0.12;
      g.add(h);
    } else if (look === 'long') {
      n.ghost.uniforms.uStretch.value = 1.45;
    } else if (look === 'chain') {
      chain ??= new THREE.Mesh(chainGeometry(), M.iron);
      const c = chain.clone();
      c.name = 'ghost-chain';
      const pivot = new THREE.Group();
      pivot.position.set(0.16, -0.58, -0.3);
      pivot.add(c);
      g.add(pivot);
      n.extra = (time, speed) => {
        pivot.rotation.x = Math.sin(time * 1.1 + n.ph) * 0.18 + clamp(speed * 0.12, 0, 0.6);
        pivot.rotation.z = Math.sin(time * 0.8 + n.ph * 2) * 0.12;
      };
    } else if (look === 'lantern') {
      cage ??= new THREE.Mesh(lanternGeometry(), M.iron);
      const l = cage.clone();
      l.name = 'ghost-lantern';
      const pivot = new THREE.Group();
      pivot.position.set(0.74, 0.25, 0.3);
      l.position.y = -0.25;
      pivot.add(l);
      g.add(pivot);
      lanterns.push(l);
      n.extra = (time, speed) => {
        pivot.rotation.z = Math.sin(time * 1.6 + n.ph) * 0.15;
        pivot.rotation.x = clamp(speed * 0.08, 0, 0.4);
      };
    }
  };

  for (const g of groups) {
    const home = typeof g.home === 'string' ? anchors[g.home] : new THREE.Vector3(...g.home);
    for (let i = 0; i < g.count; i++) {
      const ghost = makeGhost(rand() * 10, 0.9);
      ghost.group.rotation.order = 'YXZ';
      ghost.group.scale.setScalar(rr(g.scale[0], g.scale[1]));
      group.add(ghost.group);
      const n: Npc = {
        ghost,
        home,
        r: rr(g.radius[0], g.radius[1]),
        y: rr(g.rise[0], g.rise[1]),
        sp: rr(g.speed[0], g.speed[1]) * (g.eitherWay && rand() < 0.5 ? -1 : 1),
        ph: rand() * 6.28,
        a: 0,
        idles: g.idles ?? [],
        makeWay: !!g.makeWay,
        state: 'loop',
        timer: rr(6, 24),
        idle: null,
        leg: 0,
        target: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        last: new THREE.Vector3(),
        yaw: 0,
        base: 0,
        nod: -1,
        cool: 0,
        bob: 1,
        push: new THREE.Vector3(),
      };
      n.a = n.ph;
      orbit(n, n.target);
      n.pos.copy(n.target);
      n.last.copy(n.target);
      dress(n, g.looks?.[i % g.looks.length] ?? 'plain');
      npcs.push(n);
    }
  }
  const glow = new Pool(Math.max(1, lanterns.length));
  if (lanterns.length) group.add(glow.points);

  function orbit(n: Npc, out: THREE.Vector3) {
    return out.set(n.home.x + Math.cos(n.a) * n.r, n.home.y + n.y, n.home.z + Math.sin(n.a) * n.r);
  }
  /** Move `p` toward `to` by at most `step`; true when it arrives. */
  function toward(p: THREE.Vector3, to: THREE.Vector3, step: number) {
    const d = p.distanceTo(to);
    if (d <= step) {
      p.copy(to);
      return true;
    }
    p.lerp(to, step / d);
    return false;
  }
  const offset = (n: Npc, v: [number, number, number], out: THREE.Vector3) => out.set(n.home.x + v[0], n.home.y + v[1], n.home.z + v[2]);

  // An idle spot holds one ghost at a time; two drifting up the same stair overlap.
  const busy = new Set<GhostIdle>();
  let lastNod = -Infinity;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const lamp = new THREE.Vector3();

  return {
    object: group,
    update(dt, time) {
      if (dt <= 0) return;
      const P = ctx.player;
      // One nod at a time: the nearest ghost in range that hasn't nodded lately.
      if (time - lastNod > NOD_GAP && !npcs.some((n) => n.nod >= 0)) {
        let best: Npc | null = null;
        let bd = NOD_RANGE;
        for (const n of npcs) {
          const d = n.pos.distanceTo(P);
          if (n.cool <= 0 && d < bd) {
            bd = d;
            best = n;
          }
        }
        if (best) {
          best.nod = 0;
          best.cool = NOD_COOL;
          lastNod = time;
          ctx.sound('sigh', best.pos);
        }
      }

      let li = 0;
      for (const n of npcs) {
        n.timer -= dt;
        n.cool -= dt;
        let face: number | null = null;
        let sway = 0;
        switch (n.state) {
          case 'loop':
            n.a += n.sp * dt;
            orbit(n, n.target);
            if (n.timer <= 0) {
              const free = n.idles.filter((i) => !busy.has(i));
              n.idle = free.length && rand() < 0.6 ? free[Math.floor(rand() * free.length)] : null;
              if (n.idle) busy.add(n.idle);
              n.state = n.idle ? 'go' : 'pause';
              n.base = n.yaw;
              n.leg = 0;
              n.timer = rr(3, 6);
            }
            break;
          case 'pause':
            // Stop, sway, look about.
            face = n.base + Math.sin(time * 0.6 + n.ph) * 0.6;
            sway = 1;
            if (n.timer <= 0) {
              n.state = 'loop';
              n.timer = rr(14, 30);
            }
            break;
          case 'go': {
            const to = offset(n, n.idle!.path[n.leg], tmp);
            if (toward(n.target, to, (n.leg ? DRIFT : GO) * dt) && ++n.leg >= n.idle!.path.length) {
              n.state = 'linger';
              n.timer = rr(4, 8);
            }
            break;
          }
          case 'linger':
            if (n.idle!.look) {
              offset(n, n.idle!.look, tmp).sub(n.pos);
              face = Math.atan2(tmp.x, tmp.z);
            } else face = n.yaw;
            sway = 1;
            if (n.timer <= 0) {
              n.state = 'back';
              busy.delete(n.idle!);
            }
            break;
          case 'back':
            if (toward(n.target, orbit(n, tmp), GO * dt)) {
              n.state = 'loop';
              n.timer = rr(14, 30);
            }
            break;
        }

        // Ease after the target; bob less while lingering somewhere.
        n.pos.lerp(n.target, dampK(2.2, dt));
        n.bob = lerp(n.bob, n.state === 'loop' ? 1 : 0.3, dampK(1, dt));

        // In the hall, drift aside from the player's line of flight.
        if (n.makeWay) {
          tmp.subVectors(n.pos, P);
          const d = tmp.length();
          tmp2.set(0, 0, 0);
          if (d < 14) {
            const v = ctx.playerVel;
            if (v.lengthSq() > 1) dir.copy(v).normalize();
            else dir.copy(tmp).divideScalar(Math.max(d, 1e-3));
            const along = tmp.dot(dir);
            const perp = tmp.addScaledVector(dir, -along);
            const pl = perp.length();
            if (along > -3 && pl < CLEAR) {
              if (pl < 0.3) perp.crossVectors(UP, dir);
              tmp2.copy(perp.normalize()).multiplyScalar((CLEAR - pl) * clamp((14 - d) / 6, 0, 1));
            }
          }
          n.push.lerp(tmp2, dampK(tmp2.lengthSq() ? 3 : 0.8, dt));
        }

        const g = n.ghost.group;
        g.position.copy(n.pos).add(n.push);
        if (n.makeWay) {
          g.position.x = clamp(g.position.x, hall.x0 + 2, hall.x1 - 2);
          g.position.z = clamp(g.position.z, hall.z0 + 2, hall.z1 - 2);
          g.position.y = clamp(g.position.y, hall.y0 + 2.5, hall.y0 + 20);
        }
        g.position.y += Math.sin(time * 0.9 + n.ph) * 1.2 * n.bob;

        // Facing: the way it moves, or what it's looking at; a nod overrides both.
        dir.subVectors(g.position, n.last);
        const speed = dir.length() / dt;
        n.last.copy(g.position);
        if (face === null) face = speed > 0.3 ? Math.atan2(dir.x, dir.z) : n.yaw;
        let pitch = 0;
        let dip = 0;
        if (n.nod >= 0) {
          n.nod += dt;
          tmp.subVectors(P, g.position);
          face = Math.atan2(tmp.x, tmp.z);
          const t = (n.nod - 0.7) / 0.8;
          if (t > 0 && t < 1) {
            pitch = Math.sin(Math.PI * t) * (ctx.reduceMotion ? 0.15 : 0.3);
            dip = -pitch * 0.8;
          }
          if (n.nod > NOD_TIME) n.nod = -1;
        }
        n.yaw = angLerp(n.yaw, face, dampK(n.nod >= 0 ? 4 : 1.6, dt));
        g.position.y += dip;
        g.rotation.set(pitch, n.yaw, sway * Math.sin(time * 1.3 + n.ph) * 0.06);

        // The skirt trails against the motion.
        const u = n.ghost.uniforms;
        u.uTime.value = time;
        tmp.copy(dir).divideScalar(dt).multiplyScalar(-0.03).applyAxisAngle(UP, -n.yaw).clampLength(0, 0.4);
        u.uBend.value.lerp(tmp, dampK(3, dt));
        n.extra?.(time, speed);
      }

      // Lantern glows follow the lanterns.
      for (const l of lanterns) {
        l.updateWorldMatrix(true, false);
        l.getWorldPosition(lamp);
        glow.pos.set([lamp.x, lamp.y, lamp.z], li * 3);
        const fl = 0.85 + 0.15 * Math.sin(time * 7 + li) * Math.sin(time * 3.1 + li * 1.7);
        glow.col.set([2.2 * fl, 1.1 * fl, 0.35 * fl, 1], li * 4);
        glow.size[li] = 1.8;
        li++;
      }
      glow.flush();
    },
  };
}
