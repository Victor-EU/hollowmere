// Small math helpers and the mockup's 2D gradient noise.

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Frame-rate independent exponential approach factor. */
export const dampK = (k: number, dt: number) => 1 - Math.exp(-k * dt);
/** Interpolate angles the short way round. */
export function angLerp(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export type Rand = () => number;

/** Mulberry32. Each module seeds its own, so editing one doesn't reshuffle another. */
export function rng(seed: number): Rand {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const range = (rand: Rand, a: number, b: number) => a + (b - a) * rand();

// Gradient noise, roughly -0.7..0.7, on one fixed permutation so the terrain is the same every load.
const perm = new Uint8Array(512);
{
  const r = rng(1031);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

function grad(h: number, x: number, y: number): number {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const X = xi & 255;
  const Y = yi & 255;
  x -= xi;
  y -= yi;
  const u = x * x * x * (x * (x * 6 - 15) + 10);
  const v = y * y * y * (y * (y * 6 - 15) + 10);
  const a = perm[X] + Y;
  const b = perm[X + 1] + Y;
  return (
    lerp(
      lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
      lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u),
      v,
    ) * 0.7
  );
}

export function fbm(x: number, y: number, octaves = 5): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * noise2(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

export function ridged(x: number, y: number, octaves = 5): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * f, y * f) * 1.4);
    s += a * n * n;
    f *= 2.1;
    a *= 0.5;
  }
  return s;
}
