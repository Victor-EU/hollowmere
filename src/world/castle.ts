import * as THREE from 'three';
import type { Vec2, WallData, WorldData } from '../data';
import { LAYER } from '../render/layers';
import type { Heights } from './heights';
import { boathouse } from './kit/boathouse';
import { gate } from './kit/gate';
import { greatHall } from './kit/hall';
import { Kit } from './kit/kit';
import { tower, type TowerSpec } from './kit/tower';
import { viaduct } from './kit/viaduct';
import { curtainWall } from './kit/wall';
import { rng } from './math';
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

/** Assemble the castle from the kit (src/world/kit) as laid out in data/world.json. */
export function buildCastle(world: WorldData, heights: Heights, M: Materials, tex: Textures): Castle {
  const k = new Kit(M, rng(2077));
  const colliders: Colliders = { cyl: [], box: [] };
  const lanternSpots: THREE.Vector3[] = [];
  const centre: Vec2 = [world.castleCentre[0], world.castleCentre[2]];

  // Towers.
  const addTower = (t: TowerSpec) => {
    tower(k, t);
    colliders.cyl.push({ x: t.x, z: t.z, r: t.r, y0: t.base, y1: t.base + t.h + t.spire * 0.6 });
  };
  for (const t of world.towers) addTower({ x: t.at[0], z: t.at[1], r: t.r, h: t.h, spire: t.spire, base: world.towerBase, pinnacles: t.pinnacles });
  const P = world.perimeter;
  const perim = P.towers.map((t) => {
    const a = (t.angle * Math.PI) / 180;
    const spec = { x: Math.cos(a) * P.radius, z: Math.sin(a) * P.radius, r: t.r, h: t.h, spire: t.spire, base: P.base, deg: t.angle };
    addTower(spec);
    return spec;
  });

  // Curtain walls, crenellated on the side away from the castle's centre.
  const wall = (ax: number, az: number, bx: number, bz: number, base: number, top: number, th: number) => {
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const away: [number, number] = [mx + (mx - centre[0]), mz + (mz - centre[1])];
    curtainWall(k, { ax, az, bx, bz, base, top, thickness: th, outside: away });
    const len = Math.hypot(bx - ax, bz - az);
    colliders.box.push({ cx: mx, cz: mz, rot: Math.atan2(-(bz - az), bx - ax), hl: len / 2, ht: th / 2, y0: base, y1: top });
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

  // The great hall. Its box is a room, not stone: you fly in through the glass.
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
  greatHall(k, { ...HALL, bays: hw.bays });
  colliders.box.push({ cx: HALL.cx, cz: HALL.cz, rot: 0, hl: (HALL.x1 - HALL.x0) / 2, ht: (HALL.z1 - HALL.z0) / 2, y0: HALL.y0, y1: HALL.y0 + HALL.wallH, hall: true });

  const VIA_A = new V3(...world.viaduct.from);
  const VIA_B = new V3(...world.viaduct.to);
  lanternSpots.push(...viaduct(k, { a: VIA_A, b: VIA_B, spans: world.viaduct.spans }));

  const GATE = new V3(...world.gate.at);
  lanternSpots.push(...gate(k, { at: GATE, stairs: world.gate.stairs, ground: (x, z) => heights.terrain(x, z), crest: tex.crest }));

  const bh = boathouse(k, heights, world.boathouse.from, world.boathouse.toward);
  lanternSpots.push(...bh.lanterns);

  const group = k.finish('castle');

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
    m.layers.set(LAYER.late);
    group.add(m);
  }

  return {
    group,
    colliders,
    gate: GATE,
    hall: HALL,
    viaduct: { a: VIA_A, b: VIA_B },
    boatHome: bh.boatHome,
    boathouseLight: bh.light,
    lanternSpots,
  };
}
