// Side by side with a reference painting, for the look pass (design doc §3a and §8).
//
//   node tools/compare.ts <reference> <screenshot> [out.png]
//
// Writes one image: the reference (centre-cropped to the screenshot's aspect) beside the
// screenshot, each over a strip of its main colours. And prints the numbers the doc's look targets
// talk about, for both: is the sky deep blue-grey or black, how much of the frame is warm light,
// what colour the shadows and highlights are. Take a quality, never a composition: these measure
// palette and light, not layout. The paintings are references only and stay out of the repo; put
// them in reference/ (gitignored).

import sharp, { type OverlayOptions } from 'sharp';

type RGB = [number, number, number];

const [refPath, shotPath, outArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!refPath || !shotPath) {
  console.error('usage: node tools/compare.ts <reference> <screenshot> [out.png]');
  process.exit(1);
}
const out = outArg ?? shotPath.replace(/(\.\w+)?$/, '-compare.png');

/** Height of each panel in the output, and of the palette strip under it. */
const H = 540;
const STRIP = 48;
const PALETTE = 8;

const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

function hsv([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, max ? d / max : 0, max / 255];
}

const mean = (px: RGB[]): RGB => {
  const s: RGB = [0, 0, 0];
  for (const p of px) for (let k = 0; k < 3; k++) s[k] += p[k];
  return s.map((v) => v / Math.max(1, px.length)) as RGB;
};

/** k-means on a sample of pixels, seeded at luminance quantiles so the result is deterministic. */
function palette(px: RGB[], k: number): { c: RGB; share: number }[] {
  const sorted = [...px].sort((a, b) => lum(a) - lum(b));
  let centres = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)]);
  let counts = new Array(k).fill(0);
  for (let it = 0; it < 12; it++) {
    const sums = centres.map(() => [0, 0, 0]);
    counts = new Array(k).fill(0);
    for (const p of px) {
      let best = 0;
      let bd = Infinity;
      centres.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      for (let j = 0; j < 3; j++) sums[best][j] += p[j];
      counts[best]++;
    }
    centres = centres.map((c, i) => (counts[i] ? (sums[i].map((v) => v / counts[i]) as RGB) : c));
  }
  return centres.map((c, i) => ({ c, share: counts[i] / px.length })).sort((a, b) => lum(a.c) - lum(b.c));
}

interface Stats {
  p5: number;
  p50: number;
  p95: number;
  black: number;
  warm: number;
  sky: RGB;
  shadows: RGB;
  highlights: RGB;
  palette: { c: RGB; share: number }[];
}

async function load(path: string, aspect?: number) {
  let img = sharp(path).removeAlpha();
  const meta = await img.metadata();
  const w = meta.width!;
  const h = meta.height!;
  if (aspect) {
    // Centre-crop to the screenshot's aspect, so both panels frame the same proportion of sky.
    const cw = Math.min(w, Math.round(h * aspect));
    const ch = Math.min(h, Math.round(w / aspect));
    img = img.extract({ left: Math.floor((w - cw) / 2), top: Math.floor((h - ch) / 2), width: cw, height: ch });
  }
  const panel = await img.resize({ height: H }).png().toBuffer();
  const { data, info } = await sharp(panel).raw().toBuffer({ resolveWithObject: true });
  return { panel, data, w: info.width, h: info.height, aspect: w / h };
}

function stats(data: Buffer, w: number, h: number): Stats {
  const px: RGB[] = [];
  const top: RGB[] = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 3;
      const p: RGB = [data[i], data[i + 1], data[i + 2]];
      px.push(p);
      if (y < h * 0.2) top.push(p);
    }
  }
  const byLum = [...px].sort((a, b) => lum(a) - lum(b));
  const q = (f: number) => lum(byLum[Math.min(byLum.length - 1, Math.floor(f * byLum.length))]) / 255;
  const isWarm = (p: RGB) => {
    const [hue, s, v] = hsv(p);
    return hue >= 12 && hue <= 55 && s > 0.35 && v > 0.35;
  };
  return {
    p5: q(0.05),
    p50: q(0.5),
    p95: q(0.95),
    black: px.filter((p) => Math.max(...p) < 10).length / px.length,
    warm: px.filter(isWarm).length / px.length,
    sky: mean(top),
    shadows: mean(byLum.slice(0, Math.floor(byLum.length * 0.25))),
    highlights: mean(byLum.slice(Math.floor(byLum.length * 0.95))),
    palette: palette(
      px.filter((_, i) => i % 3 === 0),
      PALETTE,
    ),
  };
}

function strip(p: Stats['palette'], width: number): OverlayOptions[] {
  let x = 0;
  return p.map(({ c, share }, i) => {
    const w = i === p.length - 1 ? width - x : Math.max(1, Math.round(share * width));
    const o = { input: { create: { width: w, height: STRIP, channels: 3 as const, background: hex(c) } }, left: x, top: H };
    x += w;
    return o;
  });
}

const shot = await load(shotPath);
const ref = await load(refPath, shot.aspect);
const A = stats(ref.data, ref.w, ref.h);
const B = stats(shot.data, shot.w, shot.h);

const gap = 12;
await sharp({ create: { width: ref.w + gap + shot.w, height: H + STRIP, channels: 3, background: '#000' } })
  .composite([
    { input: ref.panel, left: 0, top: 0 },
    { input: shot.panel, left: ref.w + gap, top: 0 },
    ...strip(A.palette, ref.w),
    ...strip(B.palette, shot.w).map((o) => ({ ...o, left: (o.left ?? 0) + ref.w + gap })),
  ])
  .png()
  .toFile(out);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const blueLean = (c: RGB) => (c[2] - c[0] >= 0 ? `+${Math.round(c[2] - c[0])}` : `${Math.round(c[2] - c[0])}`);
const rows: [string, string, string, string][] = [
  ['luminance p5 / p50 / p95', [A.p5, A.p50, A.p95].map(pct).join(' / '), [B.p5, B.p50, B.p95].map(pct).join(' / '), 'brightness spread'],
  ['near-black pixels', pct(A.black), pct(B.black), 'the night is never black'],
  ['warm light', pct(A.warm), pct(B.warm), 'warm light is rare and concentrated'],
  ['sky (top fifth)', `${hex(A.sky)} blue ${blueLean(A.sky)}`, `${hex(B.sky)} blue ${blueLean(B.sky)}`, 'deep blue-grey'],
  ['shadows (darkest quarter)', `${hex(A.shadows)} blue ${blueLean(A.shadows)}`, `${hex(B.shadows)} blue ${blueLean(B.shadows)}`, 'cool, not black'],
  ['highlights (brightest 5%)', hex(A.highlights), hex(B.highlights), ''],
];
const w0 = Math.max(...rows.map((r) => r[0].length));
const w1 = Math.max(9, ...rows.map((r) => r[1].length));
const w2 = Math.max(10, ...rows.map((r) => r[2].length));
console.log(`${''.padEnd(w0)}  ${'reference'.padEnd(w1)}  ${'screenshot'.padEnd(w2)}  target (design doc §8)`);
for (const [k, a, b, t] of rows) console.log(`${k.padEnd(w0)}  ${a.padEnd(w1)}  ${b.padEnd(w2)}  ${t}`);
console.log(`wrote ${out}`);
