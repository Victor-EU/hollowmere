import * as THREE from 'three';
import { archPoints, box, lancetPath, lathe, matrix, prism, roofSlopes } from './geom';
import type { Kit } from './kit';

export interface HallSpec {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Floor height. */
  y0: number;
  wallH: number;
  ridge: number;
  bays: number;
}

/** Wall thickness; walls are centred on the hall's outline. */
const T = 1.2;
/** Side windows match the glass texture: 3.6 m span, 16 m sill to apex. */
const WIN = { span: 3.6, sill: 4, rise: 16 };
/** The gable windows are taller and wider in the same proportion. */
const GABLE_WIN = { span: 4.4, sill: 4, rise: 19.5 };
/** Where the rose sits in the glass texture (tools/tex/glass.ts), in UV. */
const ROSE_UV = { u: 0.5, v: 14.71 / 16, ru: 0.8 / 3.6, rv: 0.8 / 16 };

/** Flat glass in a lancet outline, UVs spanning its bounding box. */
function lancetGlass(cx: number, sill: number, span: number, rise: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(lancetPath(cx, sill, span, rise, 10)));
  const p = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - (cx - span / 2)) / span, (p.getY(i) - sill) / rise);
  return g;
}

/** The hood mould over a window: a band following the arch, proud of the wall. */
function hoodMould(cx: number, sill: number, span: number, rise: number): THREE.BufferGeometry {
  const spring = sill + rise - span * (Math.sqrt(3) / 2);
  const outer = archPoints(cx, spring, span + 1.0, 10);
  const inner = archPoints(cx, spring, span + 0.4, 10).reverse();
  return prism(new THREE.Shape([...outer, ...inner]), 0.3, 1);
}

/** Whether a point is inside a lancet; `lx` from its centre line, `ly` up from its sill. */
export function insideLancet(lx: number, ly: number, span: number, rise: number): boolean {
  const hw = span / 2;
  const spring = rise - span * (Math.sqrt(3) / 2);
  if (ly < 0 || ly > rise || Math.abs(lx) > hw) return false;
  return ly <= spring || (Math.hypot(lx + hw, ly - spring) <= span && Math.hypot(lx - hw, ly - spring) <= span);
}

export interface HallWall {
  name: string;
  /** The wall's plane: `axis` = `at`. Windows are measured along `along`, up from the floor. */
  axis: 'x' | 'z';
  at: number;
  along: 'x' | 'z';
  windows: { c: number; sill: number; span: number; rise: number }[];
}

/** The hall's walls and the windows in them, for the route check (src/dev/checks.ts). */
export function hallWalls(h: HallSpec): HallWall[] {
  const B = (h.x1 - h.x0) / h.bays;
  const bays = Array.from({ length: h.bays }, (_, i) => ({ c: h.x0 + (i + 0.5) * B, ...WIN }));
  const gable = [{ c: (h.z0 + h.z1) / 2, ...GABLE_WIN }];
  return [
    { name: 'south wall', axis: 'z', at: h.z1, along: 'x', windows: bays },
    { name: 'north wall', axis: 'z', at: h.z0, along: 'x', windows: bays },
    { name: 'east gable', axis: 'x', at: h.x1, along: 'z', windows: gable },
    { name: 'west gable', axis: 'x', at: h.x0, along: 'z', windows: gable },
  ];
}

export function greatHall(k: Kit, h: HallSpec) {
  const { M, rand } = k;
  const L = h.x1 - h.x0;
  const D = h.z1 - h.z0;
  const H = h.wallH;
  const R = h.ridge;
  const B = L / h.bays;
  const cx = (h.x0 + h.x1) / 2;
  const cz = (h.z0 + h.z1) / 2;
  const y0 = h.y0;
  const bayX = (i: number) => h.x0 + (i + 0.5) * B;

  // Long walls with a lancet in every bay, glass recessed towards the outside.
  const long = new THREE.Shape([
    new THREE.Vector2(h.x0 - T / 2, -3),
    new THREE.Vector2(h.x1 + T / 2, -3),
    new THREE.Vector2(h.x1 + T / 2, H),
    new THREE.Vector2(h.x0 - T / 2, H),
  ]);
  for (let i = 0; i < h.bays; i++) long.holes.push(new THREE.Path(lancetPath(bayX(i), WIN.sill, WIN.span, WIN.rise, 10)));
  const wallG = prism(long, T, 10);
  const plinth = box(L + T, 1.6, T + 0.5, rand() * 16, 0);
  const sill = box(L + T, 0.35, T + 0.4, rand() * 16, 0);
  const cornice = box(L + T + 0.6, 0.7, T + 0.8, rand() * 16, 0);
  // The south front faces the lake (+z), the north faces the courtyard.
  for (const side of [1, -1]) {
    const z = side > 0 ? h.z1 : h.z0;
    const out = z + side * (T / 2);
    k.add(wallG, M.stone, matrix(0, y0, z));
    k.add(plinth, M.stone, matrix(cx, y0 - 0.2, z));
    k.add(sill, M.stone, matrix(cx, y0 + WIN.sill - 0.2, z));
    k.add(cornice, M.stone, matrix(cx, y0 + H - 0.35, z));
    for (let i = 0; i < h.bays; i++) {
      k.add(lancetGlass(bayX(i), WIN.sill, WIN.span, WIN.rise), M.glass, matrix(0, y0, z + side * 0.3));
      k.add(hoodMould(bayX(i), WIN.sill, WIN.span, WIN.rise), M.stone, matrix(0, y0, out + side * 0.15));
    }
    // Stepped buttresses between the bays, each with a pinnacle.
    const profile = new THREE.Shape([
      new THREE.Vector2(0, -3),
      new THREE.Vector2(2.3, -3),
      new THREE.Vector2(2.3, 13.5),
      new THREE.Vector2(1.6, 15),
      new THREE.Vector2(1.6, 22.4),
      new THREE.Vector2(0.7, 24.6),
      new THREE.Vector2(0, 24.6),
    ]);
    const buttress = prism(profile, 1.5, 1);
    const shaft = box(0.8, 4.2, 0.8);
    const cap = new THREE.ConeGeometry(0.66, 3.4, 4, 1);
    cap.rotateY(Math.PI / 4);
    for (let i = 1; i < h.bays; i++) {
      const x = h.x0 + i * B;
      k.add(buttress, M.stone, matrix(x, y0, out, -side * (Math.PI / 2)));
      const pz = out + side * 1.15;
      k.add(shaft, M.stone, matrix(x, y0 + 22.2 + 2.1, pz));
      k.add(cap, M.stone, matrix(x, y0 + 26.4 + 1.7, pz));
    }
  }

  // Gable ends: a tall window, a rose above it, coped rakes standing just above the roof.
  {
    const hz = D / 2 - T / 2;
    const hzo = D / 2 + T / 2 + 0.3;
    const gable = new THREE.Shape([
      new THREE.Vector2(-hz, -3),
      new THREE.Vector2(hz, -3),
      new THREE.Vector2(hz, H),
      new THREE.Vector2(hzo, H),
      new THREE.Vector2(hzo, H + 0.9),
      new THREE.Vector2(0, H + R + 0.9),
      new THREE.Vector2(-hzo, H + 0.9),
      new THREE.Vector2(-hzo, H),
      new THREE.Vector2(-hz, H),
    ]);
    gable.holes.push(new THREE.Path(lancetPath(0, GABLE_WIN.sill, GABLE_WIN.span, GABLE_WIN.rise, 12)));
    const roseY = H + R * 0.38;
    const roseR = 1.7;
    gable.holes.push(new THREE.Path(new THREE.Path().absarc(0, roseY, roseR, 0, Math.PI * 2, false).getPoints(24)));
    const gableG = prism(gable, T, 12);
    const winG = lancetGlass(0, GABLE_WIN.sill, GABLE_WIN.span, GABLE_WIN.rise);
    // The rose borrows the rose from the glass texture.
    const roseG = new THREE.CircleGeometry(roseR, 24);
    {
      const p = roseG.getAttribute('position');
      const uv = roseG.getAttribute('uv');
      for (let i = 0; i < p.count; i++) uv.setXY(i, ROSE_UV.u + (p.getX(i) / roseR) * ROSE_UV.ru, ROSE_UV.v + (p.getY(i) / roseR) * ROSE_UV.rv);
      roseG.translate(0, roseY, 0);
    }
    const annulus = new THREE.Shape(new THREE.Path().absarc(0, roseY, roseR + 0.45, 0, Math.PI * 2, false).getPoints(24));
    annulus.holes.push(new THREE.Path(new THREE.Path().absarc(0, roseY, roseR, 0, Math.PI * 2, true).getPoints(24)));
    const ring = prism(annulus, 0.3, 1);
    const rake = Math.atan2(R, hzo);
    const coping = box(Math.hypot(hzo, R) + 0.4, 0.4, T + 0.35, rand() * 16, 0);
    const hood = hoodMould(0, GABLE_WIN.sill, GABLE_WIN.span, GABLE_WIN.rise);
    for (const x of [h.x0, h.x1]) {
      const out = x > cx ? 1 : -1;
      // Shape x runs along world z; the extrusion runs along world x.
      const frame = (lx: number, ly: number, lz: number, rz = 0) =>
        new THREE.Matrix4().compose(
          new THREE.Vector3(x - lz * 1, y0 + ly, cz + lx),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, rz, 'YXZ')),
          new THREE.Vector3(1, 1, 1),
        );
      k.add(gableG, M.stone, frame(0, 0, 0));
      k.add(winG, M.glass, frame(0, 0, -out * 0.3));
      k.add(roseG, M.glass, frame(0, 0, -out * 0.3));
      k.add(ring, M.stone, frame(0, 0, -out * (T / 2 + 0.15)));
      k.add(hood, M.stone, frame(0, 0, -out * (T / 2 + 0.15)));
      for (const s of [-1, 1]) {
        k.add(coping, M.stone, frame((s * hzo) / 2, H + 0.9 + R / 2 + 0.2, 0, -s * rake));
      }
      k.add(box(0.7, 1.8, 0.7), M.stone, frame(0, H + R + 0.9 + 0.9, 0));
    }
  }

  // Roof: slate outside, a boarded lining inside, eaves overhanging the walls.
  {
    const half = D / 2 + T / 2;
    const eave = 0.9;
    const len = L + T;
    const alpha = Math.atan2(R, half);
    k.add(roofSlopes(len, half, R, eave, 0.35), M.slate, matrix(cx, y0 + H, cz));
    k.add(roofSlopes(len, half, R, eave, 0, true), M.wood, matrix(cx, y0 + H, cz));
    const fascia = box(len, 0.5, 0.18);
    for (const side of [1, -1]) k.add(fascia, M.wood, matrix(cx, y0 + H - eave * Math.tan(alpha) + 0.1, cz + side * (half + eave)));
    k.add(box(len, 0.45, 0.7), M.iron, matrix(cx, y0 + H + R + 0.45, cz));
  }

  // Arch-braced trusses over the hall, one per bay division.
  {
    const zi = D / 2 - T / 2;
    const half = D / 2 + T / 2;
    const tanA = R / half;
    const foot = H - 7;
    const apex = H + R - 4.6;
    const mid = (foot + apex) / 2;
    const s = new THREE.Shape();
    s.moveTo(-zi, foot);
    s.lineTo(-zi + 0.6, foot);
    s.quadraticCurveTo(-zi + 0.6, mid, 0, apex);
    s.quadraticCurveTo(zi - 0.6, mid, zi - 0.6, foot);
    s.lineTo(zi, foot);
    s.lineTo(zi, H + T * tanA - 0.4);
    s.lineTo(0, H + R - 0.6);
    s.lineTo(-zi, H + T * tanA - 0.4);
    s.closePath();
    const truss = prism(s, 0.45, 12);
    const corbel = box(0.8, 0.9, 0.9);
    for (let i = 1; i < h.bays; i++) {
      const x = h.x0 + i * B;
      k.add(truss, M.wood, matrix(x, y0, cz, -Math.PI / 2));
      for (const side of [-1, 1]) k.add(corbel, M.stone, matrix(x, y0 + foot - 0.45, cz + side * (zi - 0.3)));
    }
  }

  // Flèche on the ridge.
  {
    const y = y0 + H + R;
    k.add(lathe([[1.5, y - 0.5], [1.5, y + 4.5], [1.8, y + 4.5], [1.8, y + 5.2]], 8, 16), M.stone, matrix(cx, 0, cz));
    k.add(lathe([[1.9, y + 5.2], [0.05, y + 27]], 8, 8), M.slate, matrix(cx, 0, cz));
    k.add(new THREE.ConeGeometry(0.2, 4, 6), M.iron, matrix(cx, y + 29, cz));
  }

  // Inside: flagstones, four long tables with benches, a dais with the high table.
  {
    const floor = new THREE.PlaneGeometry(L - T, D - T);
    const uv = floor.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L - T), uv.getY(i) * (D - T));
    k.add(floor, M.floor, matrix(cx, y0 + 0.05, cz, 0, -Math.PI / 2));
    const top = new THREE.BoxGeometry(48, 0.35, 2.2);
    const legs = new THREE.BoxGeometry(48, 1.8, 1.6);
    const bench = new THREE.BoxGeometry(48, 0.25, 0.6);
    for (const z of [h.z0 + 5, h.z0 + 9, h.z1 - 9, h.z1 - 5]) {
      k.add(top, M.wood, matrix(cx - 2, y0 + 1.9, z));
      k.add(legs, M.dark, matrix(cx - 2, y0 + 0.9, z));
      for (const s of [-1, 1]) k.add(bench, M.wood, matrix(cx - 2, y0 + 1.0, z + s * 1.6));
    }
    const dx = h.x1 - T / 2 - 3.5;
    k.add(box(7, 0.6, D - T, rand() * 8, 0), M.floor, matrix(dx, y0 + 0.3, cz));
    k.add(new THREE.BoxGeometry(2.4, 0.35, 14), M.wood, matrix(dx - 0.6, y0 + 0.6 + 1.9, cz));
    k.add(new THREE.BoxGeometry(1.8, 1.8, 13), M.dark, matrix(dx - 0.6, y0 + 0.6 + 0.9, cz));
  }
}
