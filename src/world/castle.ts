import * as THREE from 'three';
import type { TowerData, Vec2, WallData, WorldData } from '../data';
import { StaticBatch } from './batch';
import type { Heights } from './heights';
import { lerp, rng, type Rand } from './math';
import type { Materials } from './materials';
import type { Textures } from './textures';

const V3 = THREE.Vector3;

/** Volumes the ghost phases through. Boxes are yaw-rotated, extruded from y0 to y1. */
export interface Colliders {
  cyl: { x: number; z: number; r: number; y0: number; y1: number }[];
  box: { cx: number; cz: number; rot: number; hl: number; ht: number; y0: number; y1: number; hall?: boolean }[];
}

export interface Castle {
  /** Merged static geometry, a few draw calls. */
  group: THREE.Group;
  colliders: Colliders;
  gate: THREE.Vector3;
  hall: { x0: number; x1: number; z0: number; z1: number; y0: number; wallH: number; ridge: number; cx: number; cz: number };
  viaduct: { a: THREE.Vector3; b: THREE.Vector3 };
  /** Where the lantern boat circles. */
  boatHome: THREE.Vector3;
  /** Warm light by the boathouse door. */
  boathouseLight: THREE.Vector3;
  lanternSpots: THREE.Vector3[];
}

function scaleUV(rand: Rand, g: THREE.BufferGeometry, su: number, sv: number, ou = rand(), ov = rand()) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  return g;
}

export function buildCastle(world: WorldData, heights: Heights, M: Materials, tex: Textures): Castle {
  const rand = rng(2077);
  const cylStone = (rTop: number, rBot: number, h: number, seg = 20) =>
    scaleUV(rand, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false), Math.max(1, Math.round((2 * Math.PI * Math.max(rTop, rBot)) / 32)), h / 32);
  const coneSlate = (r: number, h: number, seg = 18) =>
    scaleUV(rand, new THREE.ConeGeometry(r, h, seg, 1, true), Math.max(1, Math.round((2 * Math.PI * r) / 8)), Math.hypot(r, h) / 8);
  const boxStone = (w: number, h: number, d: number, tile = 32) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv');
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const ou = rand();
    const ov = rand();
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile + ou, (uv.getY(i) * dims[f][1]) / tile + ov);
      }
    }
    return g;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, cast = true, recv = true) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = cast;
    o.receiveShadow = recv;
    return o;
  };

  // Everything is built into this scratch group as plain meshes, then merged at the end.
  const castle = new THREE.Group();
  castle.name = 'castle';
  const instanced = new THREE.Group();
  instanced.name = 'castle-instanced';
  const colliders: Colliders = { cyl: [], box: [] };
  const lanternSpots: THREE.Vector3[] = [];

  // Towers.
  const tower = (t: { x: number; z: number; r: number; h: number; sp: number; big?: boolean; base?: number }) => {
    const base = t.base ?? world.towerBase;
    const top = base + t.h;
    const r = t.r;
    castle.add(mesh(cylStone(r, r * 1.04, t.h), M.tower, t.x, base + t.h / 2, t.z));
    castle.add(mesh(cylStone(r * 1.16, r, 2.2, 20), M.stone, t.x, top + 1.1, t.z));
    castle.add(mesh(coneSlate(r * 1.24, t.sp), M.slate, t.x, top + 2.2 + t.sp / 2, t.z));
    castle.add(mesh(new THREE.ConeGeometry(Math.max(0.22, r * 0.05), 4 + r * 0.3, 6), M.iron, t.x, top + 2.2 + t.sp + 1.5, t.z, false));
    if (t.big) {
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        const px = t.x + Math.cos(a) * r * 1.05;
        const pz = t.z + Math.sin(a) * r * 1.05;
        castle.add(mesh(cylStone(r * 0.14, r * 0.16, 4, 8), M.stone, px, top + 3, pz));
        castle.add(mesh(coneSlate(r * 0.2, r * 1.1, 8), M.slate, px, top + 5 + r * 0.55, pz));
      }
    }
    colliders.cyl.push({ x: t.x, z: t.z, r, y0: base, y1: top + t.sp * 0.6 });
  };
  const towerSpec = (t: TowerData) => ({ x: t.at[0], z: t.at[1], r: t.r, h: t.h, sp: t.spire, big: t.pinnacles });
  world.towers.forEach((t) => tower(towerSpec(t)));
  const P = world.perimeter;
  const perim = P.towers.map((t) => {
    const a = (t.angle * Math.PI) / 180;
    const spec = { x: Math.cos(a) * P.radius, z: Math.sin(a) * P.radius, r: t.r, h: t.h, sp: t.spire, base: P.base, deg: t.angle };
    tower(spec);
    return spec;
  });

  // Curtain walls with merlons.
  const merlonSpots: [number, number, number, number][] = [];
  const wall = (ax: number, az: number, bx: number, bz: number, base: number, top: number, th = 3.6) => {
    const len = Math.hypot(bx - ax, bz - az);
    const h = top - base;
    const m = mesh(boxStone(len, h, th), M.stone, (ax + bx) / 2, base + h / 2, (az + bz) / 2);
    m.rotation.y = Math.atan2(-(bz - az), bx - ax);
    castle.add(m);
    const n = Math.floor(len / 2.6);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      merlonSpots.push([lerp(ax, bx, t), top + 0.9, lerp(az, bz, t), m.rotation.y]);
    }
    colliders.box.push({ cx: (ax + bx) / 2, cz: (az + bz) / 2, rot: m.rotation.y, hl: len / 2, ht: th / 2, y0: base, y1: top });
  };
  const PW = world.walls.perimeter;
  for (let i = 0; i < perim.length - 1; i++) {
    const a = perim[i];
    const b = perim[i + 1];
    if (PW.skip.some(([s0, s1]) => s0 === a.deg && s1 === b.deg)) continue;
    wall(a.x, a.z, b.x, b.z, PW.base, PW.top, PW.thickness);
  }
  const endpoint = (e: WallData['from']): Vec2 => {
    if (Array.isArray(e)) return e;
    const t = perim.find((p) => p.deg === e.perimeter);
    if (!t) throw new Error(`world.json: no perimeter tower at ${e.perimeter} degrees`);
    return [t.x, t.z];
  };
  for (const w of world.walls.extra) {
    const [ax, az] = endpoint(w.from);
    const [bx, bz] = endpoint(w.to);
    wall(ax, az, bx, bz, w.base, w.top, w.thickness);
  }
  {
    const im = new THREE.InstancedMesh(boxStone(1.6, 1.8, 1.0), M.stone, merlonSpots.length);
    im.name = 'merlons';
    im.castShadow = true;
    im.receiveShadow = true;
    const d = new THREE.Object3D();
    merlonSpots.forEach(([x, y, z, ry], i) => {
      d.position.set(x, y, z);
      d.rotation.set(0, ry, 0);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    });
    instanced.add(im);
  }

  // Great hall: walls are glazed planes, so you can fly in through the glass.
  const hw = world.hall;
  const HALL = {
    x0: hw.x[0],
    x1: hw.x[1],
    z0: hw.z[0],
    z1: hw.z[1],
    y0: hw.floor,
    wallH: hw.wallHeight,
    ridge: hw.ridge,
    cx: (hw.x[0] + hw.x[1]) / 2,
    cz: (hw.z[0] + hw.z[1]) / 2,
  };
  {
    const L = HALL.x1 - HALL.x0;
    const D = HALL.z1 - HALL.z0;
    const H = HALL.wallH;
    const y0 = HALL.y0;
    const bays = hw.bays;
    const longWall = () => {
      const g = new THREE.PlaneGeometry(L, H);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * bays);
      return g;
    };
    castle.add(mesh(longWall(), M.hall, HALL.cx, y0 + H / 2, HALL.z1));
    const n = mesh(longWall(), M.hall, HALL.cx, y0 + H / 2, HALL.z0);
    n.rotation.y = Math.PI;
    castle.add(n);
    const shape = new THREE.Shape([
      new THREE.Vector2(-D / 2, 0),
      new THREE.Vector2(D / 2, 0),
      new THREE.Vector2(D / 2, H),
      new THREE.Vector2(0, H + HALL.ridge),
      new THREE.Vector2(-D / 2, H),
    ]);
    const endG = () => {
      const g = new THREE.ShapeGeometry(shape);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + D / 2) / (L / bays), uv.getY(i) / H);
      return g;
    };
    const e = mesh(endG(), M.hall, HALL.x1, y0, HALL.cz);
    e.rotation.y = Math.PI / 2;
    castle.add(e);
    const w = mesh(endG(), M.hall, HALL.x0, y0, HALL.cz);
    w.rotation.y = -Math.PI / 2;
    castle.add(w);
    const half = D / 2 + 1.2;
    const sl = Math.hypot(half, HALL.ridge);
    const ang = Math.atan2(half, HALL.ridge);
    const roofG = () => scaleUV(rand, new THREE.PlaneGeometry(L + 2.5, sl), (L + 2.5) / 8, sl / 8);
    const rs = mesh(roofG(), M.slateDouble, HALL.cx, y0 + H + HALL.ridge / 2 - 0.4, HALL.cz + half / 2);
    rs.rotation.x = -(Math.PI / 2 - ang);
    castle.add(rs);
    const rn = mesh(roofG(), M.slateDouble, HALL.cx, y0 + H + HALL.ridge / 2 - 0.4, HALL.cz - half / 2);
    rn.rotation.x = Math.PI + (Math.PI / 2 - ang);
    castle.add(rn);
    // Buttresses with pinnacles.
    for (let k = 1; k < bays; k++) {
      for (const z of [HALL.z1 + 1.1, HALL.z0 - 1.1]) {
        const x = HALL.x0 + (k * L) / bays;
        castle.add(mesh(boxStone(1.5, 27, 2.2), M.stone, x, y0 + 13.5, z));
        castle.add(mesh(coneSlate(0.95, 5.5, 6), M.slate, x, y0 + 27 + 2.75, z));
      }
    }
    // Flèche on the ridge.
    castle.add(mesh(cylStone(1.3, 1.5, 7, 8), M.stone, HALL.cx, y0 + H + HALL.ridge + 3, HALL.cz));
    castle.add(mesh(coneSlate(1.9, 22, 8), M.slate, HALL.cx, y0 + H + HALL.ridge + 6.5 + 11, HALL.cz));
    // Interior.
    const floor = mesh(scaleUV(rand, new THREE.PlaneGeometry(L, D), L / 32, D / 32), M.stone, HALL.cx, y0 + 0.05, HALL.cz, false, true);
    floor.rotation.x = -Math.PI / 2;
    castle.add(floor);
    for (const z of [HALL.z0 + 5, HALL.z0 + 9, HALL.z1 - 9, HALL.z1 - 5]) {
      castle.add(mesh(new THREE.BoxGeometry(48, 0.35, 2.2), M.wood, HALL.cx + 2, y0 + 1.9, z, false));
      castle.add(mesh(new THREE.BoxGeometry(48, 1.8, 1.6), M.dark, HALL.cx + 2, y0 + 0.9, z, false));
    }
    colliders.box.push({ cx: HALL.cx, cz: HALL.cz, rot: 0, hl: L / 2, ht: D / 2, y0, y1: y0 + H, hall: true });
  }

  // Viaduct: piers, two tiers of arched spandrels, deck and parapets.
  const VIA_A = new V3(...world.viaduct.from);
  const VIA_B = new V3(...world.viaduct.to);
  {
    const dir = VIA_B.clone().sub(VIA_A);
    const L = dir.length();
    dir.normalize();
    const hd = new V3(dir.x, 0, dir.z).normalize();
    const ry = Math.atan2(-hd.z, hd.x);
    const spans = world.viaduct.spans;
    const spanLen = L / spans;
    for (let k = 0; k <= spans; k++) {
      const p = VIA_A.clone().addScaledVector(dir, k * spanLen);
      const h = p.y + 14;
      const m = mesh(boxStone(3.4, h, 7.4), M.stone, p.x, p.y - h / 2 - 0.7, p.z);
      m.rotation.y = ry;
      castle.add(m);
    }
    const spandrel = (span: number, spring: number, apex: number, top: number, depth: number) => {
      const s = new THREE.Shape();
      const w = span;
      s.moveTo(0, spring);
      s.quadraticCurveTo(0.02 * w, apex - 0.6, w / 2, apex);
      s.quadraticCurveTo(w * 0.98, apex - 0.6, w, spring);
      s.lineTo(w, top);
      s.lineTo(0, top);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
      g.translate(0, 0, -depth / 2);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 32, uv.getY(i) / 32);
      return g;
    };
    for (let k = 0; k < spans; k++) {
      const p = VIA_A.clone().addScaledVector(dir, k * spanLen);
      const y = p.y + ((VIA_B.y - VIA_A.y) / spans) * 0.5;
      const up = mesh(spandrel(spanLen, -11, -4.2, -0.7, 6.6), M.stone, p.x, y, p.z);
      up.rotation.y = ry;
      castle.add(up);
      const lo = mesh(spandrel(spanLen, -26, -19, -16.5, 6.2), M.stone, p.x, y, p.z);
      lo.rotation.y = ry;
      castle.add(lo);
    }
    const deck = new THREE.Group();
    deck.position.copy(VIA_A).add(VIA_B).multiplyScalar(0.5);
    deck.lookAt(VIA_B);
    castle.add(deck);
    deck.add(mesh(boxStone(7.4, 1.4, L + 3), M.stone, 0, -0.7, 0));
    deck.add(mesh(boxStone(0.8, 1.5, L + 3), M.stone, 3.3, 0.75, 0));
    deck.add(mesh(boxStone(0.8, 1.5, L + 3), M.stone, -3.3, 0.75, 0));
    deck.updateMatrixWorld(true);
    for (let z = -L / 2; z <= L / 2; z += 7.5) for (const x of [-3.3, 3.3]) lanternSpots.push(deck.localToWorld(new V3(x, 2.2, z)));
  }

  // Gate on the outcrop: pillars with gargoyles and banners, iron leaves, flanking walls, stairs.
  const GATE = new V3(...world.gate.at);
  {
    const y0 = GATE.y;
    const bannerMat = new THREE.MeshStandardMaterial({ name: 'banner', map: tex.crest, roughness: 0.85, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const x = GATE.x + sx * 6;
      castle.add(mesh(boxStone(3.2, 13, 3.2), M.stone, x, y0 + 6.5, GATE.z));
      castle.add(mesh(boxStone(4.2, 1, 4.2), M.stone, x, y0 + 13.5, GATE.z));
      // A crouching gargoyle, built from primitives.
      const gg = new THREE.Group();
      gg.position.set(x, y0 + 14, GATE.z);
      castle.add(gg);
      const body = mesh(new THREE.SphereGeometry(1, 12, 10), M.dark, 0, 1.1, 0);
      body.scale.set(1.05, 1.1, 1.3);
      gg.add(body);
      gg.add(mesh(new THREE.SphereGeometry(0.62, 10, 8), M.dark, 0, 2.3, 0.95));
      for (const hx of [-0.3, 0.3]) {
        const h = mesh(new THREE.ConeGeometry(0.14, 0.9, 5), M.dark, hx, 2.9, 0.75);
        h.rotation.x = -0.5;
        gg.add(h);
      }
      for (const wx of [-1, 1]) {
        const w = mesh(new THREE.ConeGeometry(0.9, 2.6, 3), M.dark, wx * 0.9, 2.1, -0.4);
        w.rotation.z = -wx * 0.5;
        w.scale.set(1, 1, 0.25);
        gg.add(w);
      }
      castle.add(mesh(new THREE.PlaneGeometry(2.2, 5.5), bannerMat, x, y0 + 7.5, GATE.z + 1.66, false));
      lanternSpots.push(new V3(x - sx * 2, y0 + 9, GATE.z + 0.6));
    }
    // Iron gate leaves, swung open.
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(GATE.x + sx * 4.4, y0, GATE.z);
      pivot.rotation.y = sx * -1.2;
      castle.add(pivot);
      for (let i = 0; i <= 7; i++) pivot.add(mesh(new THREE.BoxGeometry(0.14, 9.5, 0.14), M.iron, -sx * (i * 0.6), 4.75, 0, true, false));
      for (const y of [1, 5, 9]) pivot.add(mesh(new THREE.BoxGeometry(4.4, 0.2, 0.18), M.iron, -sx * 2.2, y, 0, true, false));
    }
    for (const [a, b] of [
      [GATE.x - 19, GATE.x - 3.6],
      [GATE.x + 3.6, GATE.x + 19],
    ]) {
      castle.add(mesh(boxStone(b - a, 6.5, 2.2), M.stone, (a + b) / 2, y0 + 3.25, GATE.z));
    }
    // Landing and stairs down to the shore path.
    castle.add(mesh(boxStone(10, 0.8, 12), M.stone, GATE.x, y0 + 0.2, GATE.z + 6));
    let y = y0;
    let z = GATE.z + 12;
    for (let i = 0; i < world.gate.stairs; i++) {
      if (y < heights.terrain(GATE.x, z) + 0.4) break;
      castle.add(mesh(boxStone(8, 1.1, 1.9), M.stone, GATE.x, y - 0.4, z));
      if (i % 4 === 0) for (const sx of [-1, 1]) lanternSpots.push(new V3(GATE.x + sx * 4.6, y + 1.6, z));
      y -= 0.85;
      z += 1.7;
    }
  }

  // Boathouse on the western shore, facing the lake.
  const boatHome = new V3();
  const boathouseLight = new V3();
  {
    const from = world.boathouse.from;
    const [sx, sz] = heights.shore(from, world.boathouse.toward);
    const dx = from[0] - sx;
    const dz = from[1] - sz;
    const dl = Math.hypot(dx, dz);
    const fx = dx / dl;
    const fz = dz / dl;
    const ix = sx - fx * 9;
    const iz = sz - fz * 9;
    const gy = Math.max(heights.terrain(ix, iz), 1);
    const bh = new THREE.Group();
    bh.position.set(ix, gy, iz);
    bh.rotation.y = Math.atan2(fx, fz);
    castle.add(bh);
    bh.add(mesh(boxStone(13, 8, 10), M.tower, 0, 4, 0));
    const tri = new THREE.Shape([new THREE.Vector2(-7.5, 0), new THREE.Vector2(7.5, 0), new THREE.Vector2(0, 7)]);
    const rg = new THREE.ExtrudeGeometry(tri, { depth: 11.5, bevelEnabled: false });
    rg.translate(0, 0, -5.75);
    scaleUV(rand, rg, 1 / 8, 1 / 8, 0, 0);
    const roof = mesh(rg, M.slate, 0, 8, 0);
    roof.rotation.y = Math.PI / 2;
    bh.add(roof);
    bh.add(mesh(cylStone(2.2, 2.4, 14, 12), M.tower, 6.5, 7, -4.5));
    bh.add(mesh(coneSlate(2.8, 9, 12), M.slate, 6.5, 18.5, -4.5));
    bh.updateMatrixWorld(true);
    for (let k = 0; k < 4; k++) {
      const p = bh.localToWorld(new V3(-2, 0, 8 + k * 5));
      castle.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 6), M.wood, p.x, -2, p.z, false));
    }
    // Pier deck in world space so it sits on the water.
    const pd = bh.localToWorld(new V3(-2, 0, 17));
    const pier = mesh(new THREE.BoxGeometry(3, 0.4, 24), M.wood, pd.x, 1.0, pd.z);
    pier.rotation.y = bh.rotation.y;
    castle.add(pier);
    lanternSpots.push(bh.localToWorld(new V3(-2, 0, 28)).setY(3.8));
    lanternSpots.push(bh.localToWorld(new V3(-5, 6, 5.3)), bh.localToWorld(new V3(4, 6, 5.3)));
    boatHome.copy(bh.localToWorld(new V3(10, 0, 40))).setY(0);
    boathouseLight.copy(bh.localToWorld(new V3(-2, 5, 14)));
  }

  // Merge everything static.
  castle.updateMatrixWorld(true);
  const batch = new StaticBatch();
  castle.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) batch.addMesh(o as THREE.Mesh);
  });
  castle.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
  });
  const group = batch.build('castle');
  group.add(instanced);

  // Cobwebs catch the light at three spots.
  const webMat = new THREE.MeshBasicMaterial({
    name: 'cobweb',
    map: tex.web,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    color: new THREE.Color(0.55, 0.6, 0.7),
  });
  for (const w of world.cobwebs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w.size, w.size), webMat);
    m.position.set(...w.at);
    m.rotation.set(0, w.yaw, w.roll);
    m.name = 'cobweb';
    group.add(m);
  }

  return { group, colliders, gate: GATE, hall: HALL, viaduct: { a: VIA_A, b: VIA_B }, boatHome, boathouseLight, lanternSpots };
}
