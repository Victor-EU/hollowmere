// Procedural masonry: coursed stone blocks with wandering edges, rounded and chipped arrises,
// recessed mortar, water streaks and lichen. Used for castle stone, flagstones, and as the
// ground of the window atlas. These are the stand-ins until generated textures are picked.

import { blur, hex, makeImg, type Img } from './image.ts';
import { clamp, fbm, fbm2, hash01, lerp, rng, smoothstep } from './noise.ts';

export interface MasonryParams {
  /** Texels across the tile. */
  size: number;
  /** Metres across the tile. */
  tile: number;
  seed: number;
  /** Course height range, metres. */
  course: [number, number];
  /** Block length range, metres. */
  length: [number, number];
  /** Mortar joint width, metres. */
  joint: number;
  /** Edge rounding, metres. */
  bevel: number;
  /** How far block edges wander from straight, metres. */
  warp: number;
  /** Per-block face offset and tilt, metres. */
  relief: number;
  /** Face texture amplitude, metres. */
  rough: number;
  /** Edge chipping, 0..1. */
  chip: number;
  /** Stone colours (sRGB); each block picks one and jitters its lightness. */
  colors: string[];
  jitter: number;
  mortar: string;
  /** Colour that water streaks and grime darken towards (sRGB). */
  grime: string;
  /** Water streaks, 0..1. */
  stains: number;
  lichen?: { color: string; amount: number };
  /** Floors: smoother, polished centres, dirt in the joints. */
  wear?: number;
}

export interface Surface {
  /** Linear RGB. */
  albedo: Img;
  /** Metres, mortar at about 0. */
  height: Img;
}

interface Row {
  y0: number;
  y1: number;
  shift: number;
  /** Block start positions from 0 to tile, plus a closing entry at `tile`. */
  starts: number[];
}

function layout(p: MasonryParams): Row[] {
  const R = rng(p.seed);
  const pick = (r: [number, number]) => r[0] + (r[1] - r[0]) * R();
  const heights: number[] = [];
  let total = 0;
  while (total < p.tile - p.course[0] * 0.5) {
    const h = pick(p.course);
    heights.push(h);
    total += h;
  }
  const sy = p.tile / total;
  const rows: Row[] = [];
  let y = 0;
  for (const h of heights) {
    const lens: number[] = [];
    let len = 0;
    while (len < p.tile - p.length[0] * 0.5) {
      const l = pick(p.length);
      lens.push(l);
      len += l;
    }
    const sx = p.tile / len;
    const starts = [0];
    for (const l of lens) starts.push(starts[starts.length - 1] + l * sx);
    starts[starts.length - 1] = p.tile;
    rows.push({ y0: y, y1: y + h * sy, shift: R() * p.tile, starts });
    y += h * sy;
  }
  rows[rows.length - 1].y1 = p.tile;
  return rows;
}

function findRow(rows: Row[], y: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].y0 <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function findBlock(starts: number[], x: number): number {
  let lo = 0;
  let hi = starts.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const wrapM = (a: number, n: number) => ((a % n) + n) % n;

export function masonry(p: MasonryParams): Surface {
  const { size: S, tile: T } = p;
  const rows = layout(p);
  const albedo = makeImg(S, S, 3);
  const height = makeImg(S, S, 1);
  const stone = p.colors.map(hex);
  const mortar = hex(p.mortar);
  const grime = hex(p.grime);
  const lichen = p.lichen ? hex(p.lichen.color) : null;
  const wear = p.wear ?? 0;
  const seed = p.seed;
  // Noise frequencies in cells per tile, chosen per metre so tiles of any size look alike.
  const per = (perMetre: number) => Math.max(1, Math.round(perMetre * T));
  const fWarp = per(0.7);
  const fFace = per(3);
  const fGrain = per(14);
  const fChip = per(4);
  const fMottle = per(2.2);
  const fSpeck = per(40);
  const fMacro = per(0.18);
  const fLichen = per(0.9);

  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      // Block edges wander a little, so courses don't read as ruled brick.
      const X = wrapM((u + 0.21) * T + p.warp * fbm(u, v, fWarp, 3, seed + 1), T);
      const Y = wrapM((v + 0.37) * T + p.warp * fbm(u, v, fWarp, 3, seed + 2), T);
      const ri = findRow(rows, Y);
      const row = rows[ri];
      const xs = wrapM(X - row.shift, T);
      const bi = findBlock(row.starts, xs);
      const x0 = row.starts[bi];
      const x1 = row.starts[bi + 1];
      const r1 = hash01(ri, bi, seed);
      const r2 = hash01(ri, bi, seed + 7);
      const r3 = hash01(ri, bi, seed + 13);

      // Rounded-rectangle distance, positive inside the block face.
      const hx = (x1 - x0) / 2 - p.joint / 2;
      const hy = (row.y1 - row.y0) / 2 - p.joint / 2;
      const lx = xs - (x0 + x1) / 2;
      const ly = Y - (row.y0 + row.y1) / 2;
      const rc = Math.min(p.bevel * 1.5, hx, hy);
      const qx = Math.abs(lx) - hx + rc;
      const qy = Math.abs(ly) - hy + rc;
      let d = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc);
      // Chipped arrises: broad bites out of some edges rather than an even fringe.
      if (d < p.bevel * 4) {
        const c = fbm(u, v, fChip, 3, seed + 3);
        d -= p.chip * p.bevel * 3 * Math.max(0, c * 2 - 0.15);
      }
      const face = smoothstep(0, p.bevel * 0.5, d);
      // The weathered, rounded arris: faces swell up from the joint over a few centimetres.
      const round = smoothstep(0, p.bevel * 2.5, d);

      // Height: block faces proud of the mortar, each with its own offset, tilt and texture.
      const nx = lx / Math.max(hx, 1e-3);
      const ny = ly / Math.max(hy, 1e-3);
      const centre = 1 - clamp(Math.max(Math.abs(nx), Math.abs(ny)), 0, 1);
      const smooth = 1 - wear * smoothstep(0, 0.6, centre);
      // Offsetting the noise per block keeps neighbours from sharing a pattern (still tiles).
      const ou = r1 * 17.3;
      const ov = r3 * 11.1;
      const faceH =
        p.relief * ((r1 - 0.5) * 0.6 + (r2 - 0.5) * nx * 0.5 + (r3 - 0.5) * ny * 0.5 + 1.2 * round) +
        p.rough * smooth * (fbm(u + ou, v + ov, fFace, 4, seed + 4) * 0.7 + fbm(u, v, fGrain, 3, seed + 5) * 0.3);
      const mortarH = -0.012 + 0.003 * fbm(u, v, fGrain, 2, seed + 6);
      const h = lerp(mortarH, faceH, face);
      height.d[y * S + x] = h;

      // Colour: a base per block, mottled per block, grain and specks over everything.
      const base = stone[Math.floor(r2 * stone.length) % stone.length];
      const lit = 1 + p.jitter * (r1 * 2 - 1);
      const mottle = 1 + 0.22 * fbm(u + ov, v + ou, fMottle, 3, seed + 8);
      const grain = 1 + 0.1 * fbm(u, v, fGrain, 3, seed + 9);
      const speck = 1 - 0.25 * smoothstep(0.45, 0.8, fbm(u, v, fSpeck, 2, seed + 17));
      const polish = 1 + 0.12 * wear * smoothstep(0.15, 0.7, centre);
      const k0 = lit * mottle * grain * speck * polish;
      let r = base[0] * k0;
      let g = base[1] * k0;
      let b = base[2] * k0;
      // Mortar, darker where it's deep.
      const m = 0.85 + 0.25 * fbm(u, v, fGrain, 2, seed + 10);
      r = lerp(mortar[0] * m, r, face);
      g = lerp(mortar[1] * m, g, face);
      b = lerp(mortar[2] * m, b, face);
      // Grime settles on the lower edge of each block.
      const low = smoothstep(0.2, 1, ny) * (1 - face * 0.6) * 0.25 + wear * (1 - face) * 0.3;
      // Water streaks run down the wall.
      const streak = p.stains * smoothstep(0.05, 0.55, fbm2(u, v, per(1.6), per(0.25), 3, seed + 11)) * (0.6 + 0.4 * fbm2(u, v, per(5), per(0.6), 2, seed + 12));
      const macro = 1 + 0.14 * fbm(u, v, fMacro, 3, seed + 14);
      const dirt = clamp(low + streak, 0, 0.85);
      r = lerp(r, grime[0], dirt) * macro;
      g = lerp(g, grime[1], dirt) * macro;
      b = lerp(b, grime[2], dirt) * macro;
      if (lichen && p.lichen) {
        const patch = smoothstep(0.25, 0.55, fbm(u, v, fLichen, 4, seed + 15)) * smoothstep(-0.1, 0.5, fbm(u, v, fGrain, 3, seed + 16));
        const k = patch * p.lichen.amount * face;
        r = lerp(r, lichen[0], k);
        g = lerp(g, lichen[1], k);
        b = lerp(b, lichen[2], k);
      }
      const i = (y * S + x) * 3;
      albedo.d[i] = r;
      albedo.d[i + 1] = g;
      albedo.d[i + 2] = b;
    }
  }
  bakeOcclusion(albedo, height, T / S);
  return { albedo, height };
}

/** Darken cavities: anything below its blurred surroundings is in shadow. */
export function bakeOcclusion(albedo: Img, height: Img, pixel: number, strength = 1) {
  const near = blur(height, 0.03 / pixel);
  const far = blur(height, 0.12 / pixel);
  for (let i = 0; i < height.d.length; i++) {
    const cav = Math.max(0, near.d[i] - height.d[i]) * 14 + Math.max(0, far.d[i] - height.d[i]) * 5;
    const ao = clamp(1 - cav * strength, 0.45, 1);
    for (let k = 0; k < 3; k++) albedo.d[i * 3 + k] *= ao;
  }
}
