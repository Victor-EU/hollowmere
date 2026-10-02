import * as THREE from 'three';
import { drawLate } from '../render/layers';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { StaticBatch } from '../world/batch';
import { hallLayout, type HallSpec } from '../world/kit/hall';
import type { Materials } from '../world/materials';
import { clamp, dampK, lerp, range, rng } from '../world/math';
import type { Textures } from '../world/textures';
import * as G from './guests';
import { chain, Creatures, ellipsoid, J, limb, Rig, rigMaterial } from './rig';
import { Pool } from './sprites';
import type { LifeContext, Living } from './types';

// The great hall's Halloween feast: about a hundred and fifty guests at four long tables and the
// high table, the tables laid with plates, goblets, roasts, pies, fruit, cakes and little cauldrons
// of something green; iron wheel chandeliers, torches and banners on the walls between the
// windows, jack-o'-lanterns the size of carts, and a witch stirring a great cauldron before the
// dais. The guests chat, drink, eat and laugh, and as you fly over they turn to watch you and
// raise their goblets. It all sits on the layout the hall's furniture was built from
// (world/kit/hall.ts), and is only drawn while the camera is in the hall.

const GOLD = '#c9a24a';
const PEWTER = '#8d8e95';
const BONE = '#c9bfa6';
/** Guests are drawn at human scale and shown about twice that, like the hall. */
const GUEST = 1.9;
/** Within this (horizontally) they watch you; within `TOAST` they raise their goblets. */
const WATCH = 16;
const TOAST = 7;

type V3 = [number, number, number];

/** A rig with nothing that moves: tableware, food, decorations. */
function prop(build: (r: Rig) => void): THREE.BufferGeometry {
  const r = new Rig();
  build(r);
  return r.build();
}
const add = (r: Rig, g: THREE.BufferGeometry | THREE.BufferGeometry[], paint: THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.ColorRepresentation), glow = 0) => r.add(g, J.body, [0, 0, 0], paint, glow);

const PROPS = {
  plate: () =>
    prop((r) => {
      add(r, limb([0, 0, 0], [0, 0.035, 0], 0.3, 0.38, 12), (p: THREE.Vector3) => (p.y > 0.03 && Math.hypot(p.x, p.z) < 0.3 ? '#6f7076' : PEWTER));
    }),
  goblet: () =>
    prop((r) => {
      add(r, ellipsoid([0, 0.015, 0], [0.1, 0.015, 0.1], 0, 8), GOLD);
      add(r, limb([0, 0.02, 0], [0, 0.2, 0], 0.025, 0.025, 5), GOLD);
      add(r, limb([0, 0.2, 0], [0, 0.36, 0], 0.05, 0.11, 10), GOLD);
      add(r, ellipsoid([0, 0.35, 0], [0.095, 0.006, 0.095], 0, 8), '#4a0a14');
    }),
  roast: () =>
    prop((r) => {
      add(r, limb([0, 0, 0], [0, 0.04, 0], 0.58, 0.62, 18), GOLD);
      add(r, ellipsoid([0, 0.27, 0], [0.32, 0.23, 0.42], 0, 12), '#6e3618');
      add(r, ellipsoid([0, 0.35, 0.12], [0.26, 0.17, 0.22], 0, 10), '#8f4a22');
      for (const s of [1, -1]) {
        add(r, limb([s * 0.24, 0.2, -0.2], [s * 0.32, 0.42, -0.38], 0.08, 0.05, 6), '#7a3f1c');
        add(r, ellipsoid([s * 0.33, 0.45, -0.4], [0.035, 0.035, 0.035], 0, 5), BONE);
      }
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        add(r, ellipsoid([Math.cos(a) * 0.5, 0.07, Math.sin(a) * 0.5], [0.07, 0.04, 0.07], 0, 5), k % 2 ? '#3f6a2a' : '#9a2a1c');
      }
    }),
  pie: () =>
    prop((r) => {
      add(r, limb([0, 0, 0], [0, 0.06, 0], 0.45, 0.5, 16), PEWTER);
      add(r, limb([0, 0.06, 0], [0, 0.19, 0], 0.44, 0.42, 16), '#b9823f');
      add(r, ellipsoid([0, 0.19, 0], [0.42, 0.05, 0.42], 0, 14), '#c8954a');
      for (let k = 0; k < 4; k++) add(r, limb([Math.cos(k * 0.8) * 0.3, 0.23, Math.sin(k * 0.8) * 0.3], [-Math.cos(k * 0.8) * 0.3, 0.23, -Math.sin(k * 0.8) * 0.3], 0.02, 0.02, 4), '#9a6a30');
    }),
  fruit: () =>
    prop((r) => {
      add(r, ellipsoid([0, 0.16, 0], [0.42, 0.16, 0.42], 0, 14), GOLD);
      const R = rng(7);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const d = k === 8 ? 0 : 0.24;
        add(r, ellipsoid([Math.cos(a) * d, 0.32 + (k === 8 ? 0.08 : 0), Math.sin(a) * d], [0.11, 0.1, 0.11], 0, 7), R() < 0.65 ? '#8e1a1a' : '#6a8a2a');
      }
      for (let k = 0; k < 8; k++) add(r, ellipsoid([0.3 + (k % 3) * 0.06, 0.36 - Math.floor(k / 3) * 0.06, 0.1 + (k % 2) * 0.05], [0.04, 0.04, 0.04], 0, 5), '#3a1d4a');
    }),
  bread: () =>
    prop((r) => {
      add(r, ellipsoid([0, 0.04, 0], [0.5, 0.04, 0.3], 0, 12), '#4a3220');
      for (const s of [1, -1]) add(r, ellipsoid([s * 0.2, 0.14, 0], [0.13, 0.1, 0.24], [0, s * 0.3, 0], 9), '#a8733a');
      add(r, ellipsoid([0, 0.15, 0.12], [0.12, 0.1, 0.12], 0, 8), '#b8833f');
    }),
  cake: () =>
    prop((r) => {
      add(r, limb([0, 0, 0], [0, 0.32, 0], 0.48, 0.48, 16), '#3a2216');
      add(r, limb([0, 0.27, 0], [0, 0.34, 0], 0.49, 0.49, 16), '#d4691e');
      add(r, limb([0, 0.34, 0], [0, 0.58, 0], 0.32, 0.32, 14), '#3a2216');
      add(r, ellipsoid([0, 0.58, 0], [0.33, 0.03, 0.33], 0, 12), '#d4691e');
      for (let k = 0; k < 5; k++) add(r, ellipsoid([Math.cos(k * 1.26) * 0.18, 0.64, Math.sin(k * 1.26) * 0.18], [0.05, 0.045, 0.05], 0, 6), '#e07a20');
    }),
  /** A little cauldron of something green. */
  brew: () =>
    prop((r) => {
      add(r, ellipsoid([0, 0.22, 0], [0.32, 0.24, 0.32], 0, 12), '#151519');
      add(r, limb([0, 0.36, 0], [0, 0.4, 0], 0.27, 0.3, 14), '#1d1d22');
      add(r, ellipsoid([0, 0.39, 0], [0.26, 0.01, 0.26], 0, 10), '#6dff5a', 1.3);
      for (let k = 0; k < 3; k++) add(r, limb([Math.cos(k * 2.1) * 0.22, 0.08, Math.sin(k * 2.1) * 0.22], [Math.cos(k * 2.1) * 0.28, 0, Math.sin(k * 2.1) * 0.28], 0.03, 0.02, 4), '#151519');
    }),
  candelabra: () =>
    prop((r) => {
      add(r, ellipsoid([0, 0.03, 0], [0.18, 0.03, 0.18], 0, 10), GOLD);
      add(r, limb([0, 0.03, 0], [0, 0.7, 0], 0.035, 0.03, 6), GOLD);
      for (const s of [1, -1]) {
        add(r, chain([[0, 0.5, 0], [s * 0.3, 0.56, 0], [s * 0.3, 0.72, 0]], [0.02, 0.02, 0.02], 5), GOLD);
        add(r, limb([s * 0.3, 0.72, 0], [s * 0.3, 0.78, 0], 0.05, 0.06, 8), GOLD);
      }
      add(r, limb([0, 0.7, 0], [0, 0.76, 0], 0.05, 0.06, 8), GOLD);
    }),
  /** A candle stuck on a skull, wax run down it. */
  skull: () =>
    prop((r) => {
      add(r, ellipsoid([0, 0.15, 0], [0.13, 0.14, 0.15], 0, 10), BONE);
      add(r, ellipsoid([0, 0.06, 0.06], [0.09, 0.04, 0.08], 0, 8), BONE);
      for (const s of [1, -1]) add(r, ellipsoid([s * 0.05, 0.16, 0.12], [0.04, 0.042, 0.025], 0, 6), '#141110');
      for (let k = 0; k < 4; k++) add(r, limb([Math.cos(k * 1.7) * 0.05, 0.28, Math.sin(k * 1.7) * 0.05], [Math.cos(k * 1.7) * 0.11, 0.12, Math.sin(k * 1.7) * 0.11], 0.02, 0.01, 4), '#efe6d2');
    }),
  bottle: () =>
    prop((r) => {
      add(r, limb([0, 0, 0], [0, 0.35, 0], 0.1, 0.1, 10), '#1d3a24');
      add(r, limb([0, 0.35, 0], [0, 0.52, 0], 0.1, 0.035, 10), '#1d3a24');
      add(r, limb([0, 0.52, 0], [0, 0.57, 0], 0.03, 0.03, 6), '#7a5a3a');
    }),
  pumpkin: () =>
    prop((r) => {
      G.pumpkin(r, [0, 0.27, 0], 0.33, J.body, [0, 0, 0], 1.6);
    }),
};
type PropName = keyof typeof PROPS;
/** Where a lit candle stands on a prop, if it has any. */
const CANDLES: Partial<Record<PropName, V3[]>> = {
  candelabra: [[0, 0.76, 0], [0.3, 0.78, 0], [-0.3, 0.78, 0]],
  skull: [[0, 0.28, 0]],
};
/** Along each long table's middle, in turn. */
const SPREAD: PropName[] = ['roast', 'candelabra', 'fruit', 'brew', 'pie', 'skull', 'bread', 'pumpkin', 'cake', 'candelabra', 'bottle', 'fruit'];

type GuestKind = 'skeleton' | 'witch' | 'vampire' | 'werewolf' | 'mummy' | 'pumpkin' | 'ghost';
const KINDS: [GuestKind, number][] = [
  ['skeleton', 3],
  ['witch', 2],
  ['vampire', 2],
  ['werewolf', 2],
  ['mummy', 1.5],
  ['pumpkin', 2],
  ['ghost', 2.5],
];
const BODIES: Record<GuestKind, () => THREE.BufferGeometry> = {
  skeleton: G.skeleton,
  witch: G.witch,
  vampire: G.vampire,
  werewolf: G.werewolf,
  mummy: G.mummy,
  pumpkin: G.pumpkinHead,
  ghost: G.ghost,
};

type Act = 'idle' | 'chat' | 'drink' | 'eat' | 'laugh' | 'toast';

interface Guest {
  mesh: Creatures;
  i: number;
  pos: THREE.Vector3;
  yaw: number;
  scale: number;
  goblet: number;
  crown: number;
  glow: number;
  act: Act;
  t: number;
  look: number;
  side: number;
  cool: number;
  ph: number;
  hp: number;
  hy: number;
  armL: number;
  armR: number;
  /** The host holds his head up; the witch at the cauldron stirs. */
  role: 'guest' | 'host' | 'stirrer';
}

export function makeFeast(hall: HallSpec, M: Materials, tex: Textures, camera: THREE.Camera, ctx: LifeContext, dense: boolean): Living {
  const rand = rng(3131);
  const rr = (a: number, b: number) => range(rand, a, b);
  const lay = hallLayout(hall);
  const y0 = hall.y0;
  const cz = (hall.z0 + hall.z1) / 2;
  const B = (hall.x1 - hall.x0) / hall.bays;
  const group = new THREE.Group();
  group.name = 'feast';
  const material = rigMaterial('feast');

  // ── The table: plates at every seat, the spread down the middle ───────────────────────────
  const placed: Record<PropName, THREE.Matrix4[]> = Object.fromEntries(Object.keys(PROPS).map((k) => [k, []])) as unknown as Record<PropName, THREE.Matrix4[]>;
  const flames: { at: THREE.Vector3; size: number; ph: number; torch: boolean }[] = [];
  const candleAt: THREE.Vector3[] = [];
  const put = (name: PropName, x: number, y: number, z: number, yaw = rand() * Math.PI * 2, s = 1) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
    placed[name].push(m);
    for (const c of CANDLES[name] ?? []) {
      const p = new THREE.Vector3(...c).applyMatrix4(m);
      candleAt.push(p);
      flames.push({ at: p.clone().add(new THREE.Vector3(0, 0.5 * s, 0)), size: 0.7 * s, ph: rand() * 6.28, torch: false });
    }
  };

  // Seats: both sides of every long table, about every 1.75 m; most are taken.
  const seats: { x: number; z: number; yaw: number; table: number }[] = [];
  lay.tables.forEach((t, ti) => {
    const n = Math.floor((t.x1 - t.x0 - 1.8) / 1.75);
    for (const side of [-1, 1]) {
      for (let k = 0; k <= n; k++) {
        const x = t.x0 + 0.9 + k * 1.75;
        seats.push({ x, z: t.z + side * lay.bench, yaw: side > 0 ? Math.PI : 0, table: ti });
        put('plate', x, lay.tableTop, t.z + side * 0.55, 0);
      }
    }
    const items = Math.floor((t.x1 - t.x0 - 2) / 3);
    for (let k = 0; k <= items; k++) put(SPREAD[(k + ti * 5) % SPREAD.length], t.x0 + 1 + k * 3, lay.tableTop, t.z + rr(-0.12, 0.12));
  });
  // Most seats are taken; an empty one has its goblet waiting on the table.
  const fill = dense ? 0.68 : 0.42;
  const chosen: { kind: GuestKind; x: number; z: number; yaw: number }[] = [];
  const totalWeight = KINDS.reduce((n, [, w]) => n + w, 0);
  for (const s of seats) {
    if (rand() > fill) {
      put('goblet', s.x + 0.35, lay.tableTop, lay.tables[s.table].z + Math.sign(s.z - lay.tables[s.table].z) * 0.82);
      continue;
    }
    let w = rand() * totalWeight;
    const kind = KINDS.find(([, kw]) => (w -= kw) < 0)?.[0] ?? 'skeleton';
    chosen.push({ kind, x: s.x, z: s.z, yaw: s.yaw });
  }
  // The high table: a boar's worth of roast in the middle, candelabras and fruit either side.
  const hi = lay.high;
  put('roast', hi.x, hi.top, cz, Math.PI / 2, 1.6);
  for (const s of [-1, 1]) {
    put('candelabra', hi.x, hi.top, cz + s * 2.5, 0, 1.25);
    put('fruit', hi.x, hi.top, cz + s * 4.2);
    put('cake', hi.x, hi.top, cz + s * 5.9);
    put('skull', hi.x - 0.4, hi.top, cz + s * 1.2);
  }
  for (const z of hi.chairs) put('plate', hi.x + 0.5, hi.top, z, 0);

  // Jack-o'-lanterns the size of carts: either side of the dais steps and of the west door.
  const giants: [number, number, number][] = [
    [lay.dais.x0 - 1.6, cz - 6.2, -Math.PI / 2],
    [lay.dais.x0 - 1.6, cz + 6.2, -Math.PI / 2],
    [hall.x0 + 3.2, hall.z0 + 3.2, Math.PI / 2 + 0.5],
    [hall.x0 + 3.2, hall.z1 - 3.2, Math.PI / 2 - 0.5],
  ];
  for (const [x, z, yaw] of giants) put('pumpkin', x, y0, z, yaw, 4.2);

  for (const name of Object.keys(PROPS) as PropName[]) {
    const list = placed[name];
    if (!list.length) continue;
    const mesh = new Creatures(`feast-${name}`, PROPS[name](), material, list.length);
    list.forEach((m, i) => mesh.set(i, m, [0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1]));
    mesh.flush();
    group.add(mesh.mesh);
  }

  // ── The hall dressed: chandeliers, torches, banners, the great cauldron ─────────────────
  const iron = new StaticBatch();
  const ironAdd = (g: THREE.BufferGeometry, m: THREE.Matrix4 = new THREE.Matrix4()) => iron.add(g, M.iron, m, false, true);
  const apex = y0 + hall.wallH + hall.ridge - 4.6;
  const ringY = y0 + 17.5;
  for (const x of [hall.x0 + 2 * B, hall.x0 + 4 * B, hall.x0 + 6 * B]) {
    const ring = new THREE.TorusGeometry(2.4, 0.09, 6, 36);
    ring.rotateX(Math.PI / 2);
    ironAdd(ring.translate(x, ringY, cz));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      ironAdd(limb([x, ringY, cz], [x + Math.cos(a) * 2.4, ringY, cz + Math.sin(a) * 2.4], 0.05, 0.05, 4));
      ironAdd(limb([x + Math.cos(a) * 2.35, ringY, cz + Math.sin(a) * 2.35], [x, ringY + 3, cz], 0.03, 0.03, 4));
    }
    ironAdd(limb([x, ringY + 3, cz], [x, apex, cz], 0.04, 0.04, 4));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p = new THREE.Vector3(x + Math.cos(a) * 2.4, ringY + 0.1, cz + Math.sin(a) * 2.4);
      ironAdd(limb([p.x, ringY, p.z], [p.x, ringY + 0.12, p.z], 0.08, 0.1, 6));
      candleAt.push(p.clone().add(new THREE.Vector3(0, 0.05, 0)));
      flames.push({ at: p.clone().add(new THREE.Vector3(0, 0.75, 0)), size: 0.9, ph: rand() * 6.28, torch: false });
    }
  }
  // Torches on the piers between the windows, a banner hanging above each.
  const bannerG: THREE.BufferGeometry[] = [];
  let design = 0;
  for (let i = 1; i < hall.bays; i++) {
    const x = hall.x0 + i * B;
    for (const side of [-1, 1]) {
      const wall = side < 0 ? hall.z0 + 0.6 : hall.z1 - 0.6;
      const into = -side;
      ironAdd(limb([x, y0 + 5.0, wall], [x, y0 + 5.6, wall + into * 0.7], 0.06, 0.05, 5));
      ironAdd(limb([x, y0 + 5.5, wall + into * 0.7], [x, y0 + 6.0, wall + into * 0.7], 0.08, 0.2, 8));
      flames.push({ at: new THREE.Vector3(x, y0 + 6.5, wall + into * 0.7), size: 1.7, ph: rand() * 6.28, torch: true });
      ironAdd(limb([x - 1.4, y0 + 15.1, wall + into * 0.12], [x + 1.4, y0 + 15.1, wall + into * 0.12], 0.05, 0.05, 5));
      const b = new THREE.PlaneGeometry(2.3, 7.2);
      const uv = b.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setX(k, (design + uv.getX(k)) / 5);
      design = (design + 1) % 5;
      b.rotateY(into > 0 ? 0 : Math.PI);
      bannerG.push(b.translate(x, y0 + 11.45, wall + into * 0.1));
    }
  }
  const banners = new THREE.Mesh(mergeGeometries(bannerG), new THREE.MeshLambertMaterial({ name: 'banner', map: tex.hallBanners, alphaTest: 0.5, side: THREE.DoubleSide }));
  banners.name = 'feast-banners';
  banners.receiveShadow = true;
  group.add(banners);

  // The great cauldron, on three legs over a log fire, in the aisle before the dais.
  const pot = new THREE.Vector3(lay.dais.x0 - 1.8, y0, cz);
  const bowl = new THREE.LatheGeometry(
    [[0.05, 0.4], [0.7, 0.42], [1.05, 0.7], [1.15, 1.0], [1.05, 1.28], [0.98, 1.34], [1.06, 1.38], [1.04, 1.44], [0.95, 1.4]].map(([x, y]) => new THREE.Vector2(x, y)),
    24,
  );
  ironAdd(bowl.translate(pot.x, pot.y, pot.z));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    ironAdd(limb([pot.x + Math.cos(a) * 0.8, y0 + 0.6, pot.z + Math.sin(a) * 0.8], [pot.x + Math.cos(a) * 1.0, y0, pot.z + Math.sin(a) * 1.0], 0.07, 0.06, 5));
  }
  group.add(iron.build('feast-iron'));
  const logs = new StaticBatch();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI + 0.3;
    logs.add(limb([pot.x - Math.cos(a) * 0.6, y0 + 0.1, pot.z - Math.sin(a) * 0.6], [pot.x + Math.cos(a) * 0.6, y0 + 0.16, pot.z + Math.sin(a) * 0.6], 0.09, 0.08, 6), M.wood, new THREE.Matrix4(), false, true);
  }
  group.add(logs.build('feast-logs'));
  const brew = new THREE.Mesh(new THREE.CircleGeometry(0.97, 24).rotateX(-Math.PI / 2).translate(pot.x, y0 + 1.3, pot.z), new THREE.MeshBasicMaterial({ name: 'brew', color: new THREE.Color(0.35, 1.7, 0.45) }));
  group.add(brew);
  const bubbles = new Pool(40);
  const steam = new Pool(50);
  group.add(bubbles.points, steam.points);
  for (const ember of [0, 1, 2, 3, 4]) flames.push({ at: new THREE.Vector3(pot.x + Math.cos(ember * 1.3) * 0.4, y0 + 0.35, pot.z + Math.sin(ember * 1.3) * 0.4), size: 1.1, ph: rand() * 6.28, torch: true });

  // Candles on the candelabras, skulls and chandeliers, and every flame in the hall in one batch.
  const candles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6).translate(0, 0.2, 0),
    new THREE.MeshStandardMaterial({ name: 'feast-candle', color: new THREE.Color('#efe6d2'), emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0.25, roughness: 0.6 }),
    candleAt.length,
  );
  candleAt.forEach((p, i) => candles.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  candles.frustumCulled = false;
  group.add(candles);
  const fire = new Pool(flames.length);
  flames.forEach((f, i) => fire.pos.set([f.at.x, f.at.y, f.at.z], i * 3));
  group.add(fire.points);

  // ── The guests ─────────────────────────────────────────────────────────────────────────
  // The high table: the host on the throne, and a lord or lady of each kind either side.
  const highKinds: GuestKind[] = ['vampire', 'witch', 'skeleton', 'werewolf', 'mummy', 'pumpkin'];
  const highSeats = hi.chairs.filter((z) => z !== cz);
  highSeats.forEach((z, k) => chosen.push({ kind: highKinds[k % highKinds.length], x: hi.chairX, z, yaw: -Math.PI / 2 }));

  const guests: Guest[] = [];
  const meshes = new Map<GuestKind, Creatures>();
  // Ghosts glow pale like the ones drifting about the hall, and you see the hall through them.
  const ghostMat = rigMaterial('feast-ghost', { transparent: true, opacity: 0.5, depthWrite: false, emissive: new THREE.Color('#7c8db2') });
  for (const [kind] of KINDS) {
    const these = chosen.filter((c) => c.kind === kind);
    if (!these.length) continue;
    const mesh = new Creatures(`guests-${kind}`, BODIES[kind](), kind === 'ghost' ? ghostMat : material, these.length);
    if (kind === 'ghost') drawLate(mesh.mesh);
    meshes.set(kind, mesh);
    group.add(mesh.mesh);
    these.forEach((c, i) => {
      const high = c.x === hi.chairX;
      guests.push(newGuest(mesh, i, new THREE.Vector3(c.x, high ? hi.seat : lay.seat, c.z), c.yaw, GUEST * (high ? 1.22 : rr(0.95, 1.05)), rand() < 0.8 ? 1 : 0, high && kind === 'skeleton' ? 1 : 0));
    });
  }
  function newGuest(mesh: Creatures, i: number, pos: THREE.Vector3, yaw: number, scale: number, goblet: number, crown: number, role: Guest['role'] = 'guest'): Guest {
    return { mesh, i, pos, yaw, scale, goblet, crown, glow: 1, act: 'idle', t: rr(0, 3), look: 0, side: rand() < 0.5 ? -1 : 1, cool: 0, ph: rand() * 6.28, hp: 0, hy: 0, armL: 0, armR: 0, role };
  }
  const hostMesh = new Creatures('guests-host', G.host(), material, 1);
  group.add(hostMesh.mesh);
  guests.push(newGuest(hostMesh, 0, new THREE.Vector3(hi.chairX, hi.seat, cz), -Math.PI / 2, GUEST * 1.35, 1, 0, 'host'));
  const witchMesh = new Creatures('guests-stirrer', G.stirringWitch(), material, 1);
  group.add(witchMesh.mesh);
  guests.push(newGuest(witchMesh, 0, new THREE.Vector3(pot.x, y0, pot.z + 1.65), Math.PI, GUEST, 1, 0, 'stirrer'));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const s = new THREE.Vector3();
  // Drawn from within the walls' thickness and the camera's near distance of the inside: past that, stone or glass hides it.
  const box = { x0: hall.x0 - 1, x1: hall.x1 + 1, z0: hall.z0 - 1, z1: hall.z1 + 1, y0: y0 - 1, y1: y0 + hall.wallH + hall.ridge };

  function animate(g: Guest, dt: number, time: number) {
    const dx = ctx.player.x - g.pos.x;
    const dz = ctx.player.z - g.pos.z;
    const d = Math.hypot(dx, dz);
    const rise = ctx.player.y - (g.pos.y + 1.5);
    const near = d < WATCH && rise < 24 && rise > -4;
    g.cool -= dt;
    if (near && d < TOAST && g.cool <= 0 && g.goblet && g.role !== 'stirrer') {
      g.act = 'toast';
      g.t = rr(1.8, 2.8);
      g.cool = rr(7, 11);
    }
    if ((g.t -= dt) <= 0) {
      const r = rand();
      g.act = r < 0.3 ? 'idle' : r < 0.6 ? 'chat' : r < 0.75 && g.goblet ? 'drink' : r < 0.9 ? 'eat' : 'laugh';
      g.t = g.act === 'idle' ? rr(1.5, 4) : g.act === 'chat' ? rr(2.5, 6) : g.act === 'laugh' ? rr(1, 2) : rr(1.2, 2.2);
      g.look = rr(-0.5, 0.5);
      g.side = rand() < 0.5 ? -1 : 1;
    }
    let hp = 0.05;
    let hy = g.look;
    let armL = 0;
    let armR = 0;
    const calm = ctx.reduceMotion;
    switch (g.act) {
      case 'chat':
        hy = g.side * 0.75;
        hp = calm ? 0 : Math.sin(time * 5 + g.ph) * 0.06;
        armL = -0.25 - (calm ? 0 : 0.2 * Math.max(0, Math.sin(time * 2.6 + g.ph)));
        break;
      case 'drink':
        armR = -1.05;
        hp = -0.25;
        hy = 0;
        break;
      case 'eat':
        armL = -0.95;
        hp = 0.15;
        hy = 0;
        break;
      case 'laugh':
        hp = -0.3 + (calm ? 0 : Math.sin(time * 9 + g.ph) * 0.06);
        armL = -0.2;
        break;
      case 'toast':
        armR = -2.1;
        break;
    }
    // Everyone near watches you go by.
    if (near) {
      const rel = Math.atan2(Math.sin(Math.atan2(dx, dz) - g.yaw), Math.cos(Math.atan2(dx, dz) - g.yaw));
      hy = clamp(rel, -1.3, 1.3);
      hp = clamp(-Math.atan2(rise, d), -0.9, 0.25);
    }
    let glow = 1;
    let yaw = g.yaw + (calm ? 0 : Math.sin(time * 0.6 + g.ph) * 0.035);
    if (g.role === 'host') {
      // He holds his head up for you to see; its face flares as you come.
      armL = -1.3 + (calm ? 0 : Math.sin(time * 1.3) * 0.06);
      glow = 1.2 + 1.8 * clamp(1 - d / WATCH, 0, 1);
    } else if (g.role === 'stirrer') {
      // Stirring, eyes on the pot until you come near.
      armR = -0.15 + (calm ? 0.1 : 0.22 * Math.sin(time * 2.4));
      yaw = g.yaw + (calm ? 0 : Math.sin(time * 1.2) * 0.12);
      if (!near) [hp, hy] = [0.4, 0];
    } else if (g.act === 'toast') glow = 1.6;
    const k = dampK(g.act === 'toast' ? 7 : 4, dt);
    g.hp = lerp(g.hp, hp, k);
    g.hy = lerp(g.hy, hy, k);
    g.armL = lerp(g.armL, armL, k);
    g.armR = lerp(g.armR, armR, k);
    g.glow = lerp(g.glow, glow, dampK(3, dt));
    m.compose(g.pos, q.setFromEuler(e.set(0, yaw, 0)), s.setScalar(g.scale));
    g.mesh.set(g.i, m, [g.hp, g.hy, 0, 0], [g.armL, g.armR, 0, 0], [g.goblet, g.glow, 1, g.crown]);
  }

  const inside = (p: THREE.Vector3) => p.x > box.x0 && p.x < box.x1 && p.z > box.z0 && p.z < box.z1 && p.y > box.y0 && p.y < box.y1;
  /** Whether a camera drew it last frame. */
  let seen = false;

  const living: Living = {
    object: group,
    // Only drawn from inside the hall: the walls and the glass hide it from everywhere else.
    cull(cam) {
      group.visible = inside(cam.position);
      seen ||= group.visible;
    },
    update(dt, time) {
      const active = seen || inside(ctx.player) || inside(camera.position);
      seen = false;
      if (!active) return;
      for (const g of guests) animate(g, dt, time);
      for (const mesh of meshes.values()) mesh.flush();
      hostMesh.flush();
      witchMesh.flush();
      flames.forEach((f, i) => {
        const fl = 0.8 + 0.2 * Math.sin(time * 13 + f.ph * 5) * (f.torch ? Math.sin(time * 5.3 + f.ph) : 1);
        fire.col.set(f.torch ? [2.0 * fl, 0.85 * fl, 0.25 * fl, 0.9] : [1.8 * fl, 1.0 * fl, 0.32 * fl, 0.9], i * 4);
        fire.size[i] = f.size;
      });
      fire.flush();
      // The brew bubbles, and a green steam rises from it.
      if (rand() < dt * 18) {
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * 0.85;
        bubbles.emit(pot.x + Math.cos(a) * r, y0 + 1.32, pot.z + Math.sin(a) * r, 0, rr(0.2, 0.5), 0, rr(0.4, 0.8));
      }
      if (rand() < dt * 9) steam.emit(pot.x + rr(-0.5, 0.5), y0 + 1.5, pot.z + rr(-0.5, 0.5), rr(-0.15, 0.15), rr(0.6, 1.1), rr(-0.15, 0.15), rr(2.5, 4));
      bubbles.update(dt, 1, (i, t, p) => {
        p.col.set([0.4 * (1 - t), 1.5 * (1 - t), 0.45 * (1 - t), 1], i * 4);
        p.size[i] = 0.18 + t * 0.12;
      });
      steam.update(dt, 0.3, (i, t, p) => {
        const a = Math.sin(t * Math.PI) * 0.22;
        p.col.set([0.35 * a, 0.9 * a, 0.45 * a, a], i * 4);
        p.size[i] = 0.8 + t * 2.4;
      });
    },
  };
  // Seated and lit from the start, wherever the camera is.
  seen = true;
  living.update(0, 0);
  return living;
}
