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

/** Where the feast sits: shared by the furniture here and the feast (src/life/feast.ts). */
export interface HallLayout {
  /** The long tables: each one's centre line z, from x0 to x1. */
  tables: { z: number; x0: number; x1: number }[];
  /** World heights of the table tops and the bench seats; a bench's centre is `bench` from its table's. */
  tableTop: number;
  seat: number;
  bench: number;
  /** The aisle up the middle to the dais. */
  aisle: { z: number; half: number };
  dais: { x0: number; x1: number; top: number };
  /** The high table, on the dais facing down the hall: its centre line x, ends, top, seat height, and the chairs (x, and each z). */
  high: { x: number; z0: number; z1: number; top: number; seat: number; chairX: number; chairs: number[] };
}

export function hallLayout(h: HallSpec): HallLayout {
  const cz = (h.z0 + h.z1) / 2;
  const dais0 = h.x1 - T / 2 - 7;
  const dTop = h.y0 + 0.6;
  return {
    tables: [-7.1, -3.1, 3.1, 7.1].map((dz) => ({ z: cz + dz, x0: h.x0 + 7, x1: dais0 - 3.4 })),
    tableTop: h.y0 + 2.05,
    seat: h.y0 + 1.5,
    bench: 1.45,
    aisle: { z: cz, half: 1.35 },
    dais: { x0: dais0, x1: h.x1 - T / 2, top: dTop },
    high: { x: dais0 + 2, z0: cz - 6.5, z1: cz + 6.5, top: dTop + 2.05, seat: dTop + 1.5, chairX: dais0 + 3.6, chairs: [-5.4, -3.4, -1.6, 0, 1.6, 3.4, 5.4].map((dz) => cz + dz) },
  };
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

  // Inside: flagstones, a carpet up the aisle to the dais, four long tables dressed in linen with
  // benches either side, and on the dais the high table in velvet, a throne and high-backed chairs.
  // The feast itself (src/life/feast.ts) is laid on these, from the same layout.
  {
    const lay = hallLayout(h);
    const floor = new THREE.PlaneGeometry(L - T, D - T);
    const uv = floor.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L - T), uv.getY(i) * (D - T));
    k.add(floor, M.floor, matrix(cx, y0 + 0.05, cz, 0, -Math.PI / 2));

    const c0 = h.x0 + T / 2 + 0.4;
    const c1 = lay.dais.x0 - 0.8;
    const cw = lay.aisle.half * 2 - 0.6;
    k.add(new THREE.BoxGeometry(c1 - c0, 0.06, cw), M.cloth, matrix((c0 + c1) / 2, y0 + 0.08, cz));
    for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(c1 - c0, 0.07, 0.14), M.gold, matrix((c0 + c1) / 2, y0 + 0.085, cz + s * (cw / 2 - 0.14)));

    for (const t of lay.tables) {
      const len = t.x1 - t.x0;
      const mx = (t.x0 + t.x1) / 2;
      const under = lay.tableTop - 0.3 - y0;
      k.add(new THREE.BoxGeometry(len, 0.3, 2.0), M.wood, matrix(mx, lay.tableTop - 0.17, t.z));
      k.add(new THREE.BoxGeometry(len - 1, under, 1.4), M.dark, matrix(mx, y0 + under / 2, t.z));
      // Linen over the top, hanging down both long sides.
      k.add(new THREE.BoxGeometry(len + 0.3, 0.04, 2.2), M.cloth, matrix(mx, lay.tableTop - 0.01, t.z));
      const seatUnder = lay.seat - 0.22 - y0;
      for (const s of [-1, 1]) {
        k.add(new THREE.BoxGeometry(len + 0.3, 0.75, 0.04), M.cloth, matrix(mx, lay.tableTop - 0.39, t.z + s * 1.1));
        k.add(new THREE.BoxGeometry(len, 0.22, 0.7), M.wood, matrix(mx, lay.seat - 0.11, t.z + s * lay.bench));
        k.add(new THREE.BoxGeometry(len - 0.6, seatUnder, 0.4), M.dark, matrix(mx, y0 + seatUnder / 2, t.z + s * lay.bench));
      }
    }

    // The dais, a step up to it, and the high table facing down the hall.
    const d = lay.dais;
    k.add(box(d.x1 - d.x0, 0.6, D - T, rand() * 8, 0), M.floor, matrix((d.x0 + d.x1) / 2, y0 + 0.3, cz));
    k.add(box(0.8, 0.3, D - T - 2, rand() * 8, 0), M.floor, matrix(d.x0 - 0.4, y0 + 0.15, cz));
    const hi = lay.high;
    const hl = hi.z1 - hi.z0;
    const hUnder = hi.top - 0.3 - d.top;
    k.add(new THREE.BoxGeometry(2.0, 0.3, hl), M.wood, matrix(hi.x, hi.top - 0.17, cz));
    k.add(new THREE.BoxGeometry(1.4, hUnder, hl - 1), M.dark, matrix(hi.x, d.top + hUnder / 2, cz));
    k.add(new THREE.BoxGeometry(2.2, 0.04, hl + 0.3), M.velvet, matrix(hi.x, hi.top - 0.01, cz));
    k.add(new THREE.BoxGeometry(0.04, 0.9, hl + 0.3), M.velvet, matrix(hi.x - 1.1, hi.top - 0.46, cz));
    k.add(new THREE.BoxGeometry(0.06, 0.1, hl + 0.3), M.gold, matrix(hi.x - 1.12, hi.top - 0.9, cz));
    // High-backed chairs with gilt finials; the throne in the middle, taller still.
    for (const z of hi.chairs) {
      const throne = z === cz;
      const back = throne ? 4.6 : 2.9;
      const w = throne ? 1.6 : 1.05;
      const bx = hi.chairX + 0.55;
      const base = hi.seat - 0.2 - d.top;
      k.add(new THREE.BoxGeometry(0.95, 0.2, w), M.wood, matrix(hi.chairX, hi.seat - 0.1, z));
      k.add(new THREE.BoxGeometry(0.7, base, w - 0.2), M.dark, matrix(hi.chairX, d.top + base / 2, z));
      k.add(new THREE.BoxGeometry(0.18, back, w), M.wood, matrix(bx, hi.seat + back / 2, z));
      k.add(new THREE.BoxGeometry(0.06, back - 0.7, w - 0.3), throne ? M.velvet : M.cloth, matrix(bx - 0.12, hi.seat + back / 2, z));
      for (const s of [-1, 1]) k.add(new THREE.ConeGeometry(0.12, 0.55, 6), M.gold, matrix(bx, hi.seat + back + 0.27, z + s * (w / 2 - 0.1)));
      if (throne) {
        k.add(new THREE.ConeGeometry(0.24, 1.1, 6), M.gold, matrix(bx, hi.seat + back + 0.55, z));
        for (const s of [-1, 1]) k.add(new THREE.BoxGeometry(0.95, 0.14, 0.14), M.gold, matrix(hi.chairX, hi.seat + 0.55, z + s * (w / 2 - 0.07)));
      }
    }
  }
}
