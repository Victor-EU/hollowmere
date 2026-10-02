import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldData } from '../data';
import { shadows } from '../render/shadows';
import type { Colliders } from '../world/castle';
import type { Heights } from '../world/heights';
import { angLerp, clamp, dampK, lerp, range, rng } from '../world/math';
import type { Materials } from '../world/materials';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

/** Body radius up the figure, metres: root-spread base, waist, shoulders, then the neck in the hood. */
const BODY: [y: number, r: number][] = [
  [-0.2, 1.0],
  [0.3, 0.95],
  [0.8, 0.82],
  [1.6, 0.72],
  [2.4, 0.66],
  [3.0, 0.74],
  [3.45, 0.82],
  [3.75, 0.8],
  [3.85, 0.45],
  [3.95, 0.2],
];
/** The hood, from the shoulders to its point. */
const HOOD: [y: number, r: number][] = [
  [3.7, 0.8],
  [4.1, 0.82],
  [4.5, 0.76],
  [4.85, 0.56],
  [5.05, 0.3],
  [5.2, 0.04],
];
/** Half-width (radians from the front) of the hood's opening, where the lantern is. */
const OPENING = 0.9;
const LANTERN = new THREE.Vector3(0, 4.3, 0.26);
/** Where the lantern rests: facing forward, tipped down toward the top of the stairs (+x pitch is down). */
const REST_PITCH = 0.45;
const TURN_BACK = 3;

const profile = (table: [number, number][], y: number) => {
  let i = 0;
  while (i < table.length - 2 && table[i + 1][0] < y) i++;
  const [y0, r0] = table[i];
  const [y1, r1] = table[i + 1];
  return lerp(r0, r1, clamp((y - y0) / (y1 - y0), 0, 1));
};
/** A point on a surface of revolution: θ = 0 faces the front (+z). */
const around = (theta: number, r: number, y: number) => new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);

/** A tube along a smooth curve through `pts`, its radius tapering by `radius(t)`. */
function strand(pts: THREE.Vector3[], radius: (t: number) => number, color: THREE.Color, segs = 5): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const n = Math.max(8, Math.round(curve.getLength() / 0.12));
  const g = new THREE.TubeGeometry(curve, n, 1, segs, false);
  const p = g.getAttribute('position');
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    curve.getPointAt(i / n, c);
    const r = radius(i / n);
    for (let j = 0; j <= segs; j++) {
      const k = i * (segs + 1) + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  const colors = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) colors.set([color.r, color.g, color.b], k * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g.toNonIndexed();
}

/**
 * The Lantern Warden: a 5 m hooded figure woven from roots and iron bands, standing by the gate,
 * with an iron lantern where its head would be. Its roots trail into the ground. It never moves,
 * except the lantern: come within about 20 m on its side of the gate and the lantern turns to
 * follow you, a spotlight that throws your ghost's shadow long across the stones, with a low creak
 * of roots. It turns back over 3 s after you leave. The only spotlight shadow in the scene (1024).
 */
export function makeWarden(world: WorldData, heights: Heights, M: Materials, ctx: LifeContext, colliders: Colliders): Living {
  const rand = rng(5150);
  const rr = (a: number, b: number) => range(rand, a, b);
  const cfg = world.life.warden;
  const [x, z] = cfg.at;
  const ground = heights.ground(x, z);
  const root = new THREE.Group();
  root.name = 'warden';
  // The figure, placed and turned; sprites stay in world space beside it.
  const group = new THREE.Group();
  group.name = 'warden-figure';
  group.position.set(x, ground, z);
  root.add(group);
  const yaw = Math.atan2(cfg.facing[0] - x, cfg.facing[1] - z);
  group.rotation.y = yaw;
  // You phase through it like stone.
  colliders.cyl.push({ x, z, r: 1.1, y0: ground - 1, y1: ground + 5.1 });

  // Roots: a dark core, so the gaps between strands read as depth, then the strands woven round it.
  const bark = [new THREE.Color('#2b2219'), new THREE.Color('#33281d'), new THREE.Color('#251d16'), new THREE.Color('#2e2a20')];
  const tint = () => bark[Math.floor(rand() * bark.length)].clone().multiplyScalar(rr(0.8, 1.15));
  const parts: THREE.BufferGeometry[] = [];
  {
    const core = new THREE.LatheGeometry(
      BODY.map(([y, r]) => new THREE.Vector2(r * 0.92, y)),
      24,
    );
    // The inside of the hood, round the back from one side of the opening to the other. Turned to
    // face inward: seen through the opening, it is the dark behind the lantern.
    const hood = new THREE.LatheGeometry(
      HOOD.map(([y, r]) => new THREE.Vector2(r * 0.93, y)),
      20,
      OPENING,
      Math.PI * 2 - OPENING * 2,
    );
    const dark = new THREE.Color('#120e0b');
    for (const g of [core, hood]) {
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      const flat = g.toNonIndexed();
      if (g === hood) {
        const p = flat.getAttribute('position');
        for (let i = 0; i < p.count; i += 3) {
          const [ax, ay, az] = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
          p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
          p.setXYZ(i + 2, ax, ay, az);
        }
      }
      flat.computeVertexNormals();
      const p = flat.getAttribute('position');
      flat.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(dark.r), 3));
      parts.push(flat);
    }
  }
  const N = 28;
  for (let k = 0; k < N; k++) {
    const th0 = (k / N) * Math.PI * 2 + rr(-0.08, 0.08);
    const twist = (k % 2 ? 1 : -1) * rr(0.22, 0.4);
    const toHood = rand() < 0.55;
    const yEnd = toHood ? 3.8 : rr(2.2, 3.7);
    const pts: THREE.Vector3[] = [];
    // Some start out on the ground and arch in, as if grown there. Fewer behind, where the wall is.
    const behind = Math.cos(th0) < -0.4;
    if (k % 3 === 0 || (!behind && k % 3 === 1)) {
      const R0 = behind ? rr(1.6, 2.2) : rr(2.2, 4.2);
      pts.push(around(th0 + rr(-0.2, 0.2), R0, -0.35), around(th0, R0 * 0.62, 0.24));
    }
    let th = th0;
    for (let y = 0.2; y <= yEnd + 1e-6; y += 0.3) {
      th = th0 + twist * y + 0.1 * Math.sin(3 * y + k);
      pts.push(around(th, profile(BODY, y) * 1.04 + 0.03 * Math.sin(5 * y + k), y));
    }
    if (toHood) {
      // Over the hood to its point, keeping clear of the opening.
      let a = Math.atan2(Math.sin(th), Math.cos(th));
      if (Math.abs(a) < OPENING + 0.12) a = Math.sign(a || 1) * (OPENING + 0.12);
      for (const y of [4.1, 4.5, 4.85]) pts.push(around(a, profile(HOOD, y) * 1.04, y));
      pts.push(new THREE.Vector3(0, 5.22, -0.06));
    }
    const r0 = rr(0.1, 0.15);
    parts.push(strand(pts, (t) => lerp(r0, 0.035, Math.pow(t, 1.4)) * (1 + 0.15 * Math.sin(t * 40 + k)), tint()));
  }
  // The rim of the hood's opening, and arms folded across the chest.
  const rim = (inset: number) => [
    around(-OPENING - 0.05, 0.82 * inset, 3.72),
    around(-OPENING + 0.08, 0.78 * inset, 4.45),
    new THREE.Vector3(0, 4.98, 0.6 * inset),
    around(OPENING - 0.08, 0.78 * inset, 4.45),
    around(OPENING + 0.05, 0.82 * inset, 3.72),
  ];
  parts.push(strand(rim(1.05), () => 0.13, tint(), 6));
  for (const sx of [-1, 1]) {
    for (let s = 0; s < 3; s++) {
      const o = (s - 1) * 0.09;
      const pts = [
        new THREE.Vector3(sx * 0.82, 3.5 + o, 0.05),
        new THREE.Vector3(sx * 0.8, 2.95 + o, 0.42),
        new THREE.Vector3(sx * 0.42, 2.5 + o, 0.76),
        new THREE.Vector3(-sx * 0.22, 2.36 + o + (sx > 0 ? 0.1 : 0), 0.78),
      ];
      parts.push(strand(pts, (t) => lerp(0.1, 0.05, t), tint()));
    }
  }
  const roots = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ name: 'warden-roots', vertexColors: true, roughness: 0.95 }));
  roots.name = 'warden-roots';
  roots.castShadow = roots.receiveShadow = true;
  group.add(roots);

  // Iron bands round the body, and an iron edge to the opening.
  {
    const bands: THREE.BufferGeometry[] = [];
    for (const y of [0.95, 2.25, 3.35]) {
      const r = profile(BODY, y) * 1.1;
      const b = new THREE.CylinderGeometry(r, r * 1.02, 0.16, 28, 1, true);
      b.rotateX(rr(-0.05, 0.05));
      b.rotateZ(rr(-0.05, 0.05));
      bands.push(b.translate(0, y, 0).toNonIndexed());
    }
    const edge = strand(rim(0.98), () => 0.045, new THREE.Color(1, 1, 1), 5);
    edge.deleteAttribute('color');
    bands.push(edge);
    for (const b of bands) b.deleteAttribute('uv');
    const iron = new THREE.Mesh(mergeGeometries(bands)!, M.iron);
    iron.name = 'warden-iron';
    iron.castShadow = iron.receiveShadow = true;
    group.add(iron);
  }

  // The lantern: an iron frame round four amber panes, on a pivot that turns.
  const head = new THREE.Group();
  head.name = 'warden-lantern';
  head.position.copy(LANTERN);
  head.rotation.order = 'YXZ';
  head.rotation.x = REST_PITCH;
  group.add(head);
  {
    const frame = [
      new THREE.BoxGeometry(0.56, 0.07, 0.56).translate(0, 0.33, 0),
      new THREE.ConeGeometry(0.36, 0.26, 4).rotateY(Math.PI / 4).translate(0, 0.49, 0),
      new THREE.TorusGeometry(0.1, 0.02, 4, 12).translate(0, 0.68, 0),
      new THREE.BoxGeometry(0.5, 0.07, 0.5).translate(0, -0.33, 0),
      new THREE.CylinderGeometry(0.12, 0.2, 0.1, 8).translate(0, -0.41, 0),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.BoxGeometry(0.05, 0.62, 0.05).translate(sx * 0.24, 0, sz * 0.24))),
    ];
    const f = new THREE.Mesh(mergeGeometries(frame.map((g) => g.toNonIndexed()))!, M.iron);
    f.name = 'warden-lantern-frame';
    head.add(f);
    const panes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) panes.push(new THREE.PlaneGeometry(0.44, 0.58).translate(0, 0, 0.235).rotateY((i * Math.PI) / 2));
    const glass = new THREE.Mesh(
      mergeGeometries(panes)!,
      new THREE.MeshStandardMaterial({ name: 'warden-glass', color: new THREE.Color('#2a1a0c'), emissive: new THREE.Color('#ffb060'), emissiveIntensity: 2.2, roughness: 0.3, side: THREE.DoubleSide }),
    );
    glass.name = 'warden-glass';
    head.add(glass);
  }
  const flame = new Pool(1);
  root.add(flame.points);
  const glassMat = (head.getObjectByName('warden-glass') as THREE.Mesh).material as THREE.MeshStandardMaterial;

  // Its light. Decay 1 like the other warm lights (world/lights.ts).
  const spot = new THREE.SpotLight(new THREE.Color('#ffb066'), 0, 46, 0.42, 0.65, 1);
  spot.name = 'warden-spot';
  spot.position.set(0, 0, 0.12);
  spot.target.position.set(0, 0, 10);
  head.add(spot, spot.target);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0005;
  spot.shadow.normalBias = 0.04;
  spot.shadow.camera.near = 0.5;
  // Redrawn only while something in its light moves (render/shadows.ts). Drawn on the first frame
  // too, though everything still casts then: a shadow sampler with no depth map behind it is a GL error.
  spot.shadow.autoUpdate = false;
  spot.shadow.needsUpdate = true;

  let following = false;
  let lastSeen = -Infinity;
  let turningBack = false;
  const base = new THREE.Vector3();
  const lamp = new THREE.Vector3();
  const local = new THREE.Vector3();
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  let prevYaw = 0;
  let prevPitch = REST_PITCH;
  // Its map is first drawn after the moon's, when only the ghost still casts.
  let drawn = false;

  return {
    object: root,
    update(dt, time) {
      const P = ctx.player;
      group.updateMatrixWorld();
      head.getWorldPosition(lamp);
      base.set(x, ground, z);
      const d = lamp.distanceTo(P);
      // Only on its own side of the gate: it never looks (or shines) through the wall behind it.
      const front = local.subVectors(P, base).dot(fwd) > -1.5;
      const near = front && d < (following ? cfg.reach + 2 : cfg.reach);
      if (near && !following) ctx.sound('creak', lamp);
      if (near) lastSeen = time;
      following = near;
      // Where the player is, in the figure's own frame, as yaw and pitch from the lantern.
      local.copy(P);
      group.worldToLocal(local).sub(LANTERN);
      let wantYaw = 0;
      let wantPitch = REST_PITCH;
      if (following) {
        wantYaw = clamp(Math.atan2(local.x, local.z), -1.6, 1.6);
        wantPitch = clamp(Math.atan2(-local.y, Math.hypot(local.x, local.z)), -0.55, 0.9);
      }
      const back = !following && time - lastSeen > 0.4;
      if (back && !turningBack && Math.abs(head.rotation.y) > 0.05) ctx.sound('creak', lamp);
      turningBack = back;
      // Follows briskly; turns back over about three seconds.
      const k = dampK(following ? 2.5 : 3 / TURN_BACK, dt);
      head.rotation.y = angLerp(head.rotation.y, wantYaw, k);
      head.rotation.x = lerp(head.rotation.x, wantPitch, k);

      // The flame flickers like the other lanterns; well under 3 Hz.
      const wave = Math.sin(time * 7 + 3) * Math.sin(time * 3.1 + 5.1);
      const fl = 0.9 + 0.1 * wave;
      spot.intensity = cfg.light * fl;
      glassMat.emissiveIntensity = 2.2 * fl;
      flame.pos.set([lamp.x, lamp.y, lamp.z], 0);
      flame.col.set([2.2 * fl, 1.1 * fl, 0.35 * fl, 1], 0);
      flame.size[0] = 2.4;
      flame.flush();

      // Redraw its shadow map while the lantern turns or the ghost is in its reach.
      const moving = Math.abs(head.rotation.y - prevYaw) + Math.abs(head.rotation.x - prevPitch) > 1e-4;
      prevYaw = head.rotation.y;
      prevPitch = head.rotation.x;
      if (shadows.baked && (!drawn || moving || d < spot.distance)) {
        spot.shadow.needsUpdate = true;
        drawn = true;
      }
    },
  };
}
