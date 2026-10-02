// Tileable noise for the texture tools. Every function takes coordinates in tile units (0..1 wraps)
// and a lattice period, so anything built from them repeats seamlessly.

export type Rand = () => number;

/** Mulberry32, same as src/world/math.ts. */
export function rng(seed: number): Rand {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of a lattice point, 0..2^32. */
export function ihash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash of a lattice point, 0..1. */
export const hash01 = (x: number, y: number, seed: number) => ihash(x, y, seed) / 4294967296;

const GX = new Float32Array(256);
const GY = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const a = (i / 256) * Math.PI * 2;
  GX[i] = Math.cos(a);
  GY[i] = Math.sin(a);
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise, about -1..1, repeating every `px` x `py` lattice cells. */
export function pnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ix0 = mod(x0, px);
  const iy0 = mod(y0, py);
  const ix1 = ix0 + 1 === px ? 0 : ix0 + 1;
  const iy1 = iy0 + 1 === py ? 0 : iy0 + 1;
  const g00 = ihash(ix0, iy0, seed) & 255;
  const g10 = ihash(ix1, iy0, seed) & 255;
  const g01 = ihash(ix0, iy1, seed) & 255;
  const g11 = ihash(ix1, iy1, seed) & 255;
  const n00 = GX[g00] * fx + GY[g00] * fy;
  const n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
  const n01 = GX[g01] * fx + GY[g01] * (fy - 1);
  const n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.41;
}

/**
 * Fractal noise over a tile. `u, v` are tile coordinates (0..1), `freq` is the number of lattice
 * cells across the tile for the first octave (an integer, so the tile wraps).
 */
export function fbm(u: number, v: number, freq: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u * f, v * f, f, f, seed + o * 101);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Same, but each axis has its own cell count, for streaks and grain that run one way. */
export function fbm2(u: number, v: number, fu: number, fv: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const k = 1 << o;
    sum += amp * pnoise(u * fu * k, v * fv * k, fu * k, fv * k, seed + o * 101);
    norm += amp;
    amp *= gain;
  }
  return sum / norm;
}

/** Ridged fractal noise, 0..1, for cracks and veins. */
export function ridged(u: number, v: number, freq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(pnoise(u * f, v * f, f, f, seed + o * 101));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
