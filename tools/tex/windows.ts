// Window atlas: castle stone with lancets, double lancets and arrow slits, each lit, dim or dark,
// plus the matching emissive map. Windows sit on a grid so they line up in floors up a tower.

import { hex, makeImg, type Img } from './image.ts';
import { masonry, type MasonryParams, type Surface } from './masonry.ts';
import { clamp, fbm, hash01, lerp, rng, smoothstep } from './noise.ts';

export interface WindowAtlasParams extends MasonryParams {
  /** Grid cells across and down the tile. */
  grid: [number, number];
  /** Chance of each kind per cell; the rest are blank. */
  kinds: { lancet: number; double: number; slit: number };
  /** Of the windows, the share lit and dim; the rest are dark. */
  lit: number;
  dim: number;
  /** Dressed stone around the openings (sRGB). */
  dressed: string;
}

export interface Atlas extends Surface {
  /** Linear RGB. */
  emissive: Img;
}

type Kind = 'lancet' | 'double' | 'slit';

interface Win {
  kind: Kind;
  /** Centre x and sill y in metres; y runs down the image. */
  x: number;
  y: number;
  w: number;
  h: number;
  light: number;
  tone: number;
}

const SQ3 = Math.sqrt(3) / 2;

/** Signed distance to a lancet (pointed, equilateral arch), positive inside. `ly` is up from the sill. */
export function lancet(lx: number, ly: number, w: number, h: number): number {
  const hw = w / 2;
  const spring = h - w * SQ3;
  if (ly <= spring) return Math.min(hw - Math.abs(lx), ly);
  return Math.min(w - Math.hypot(lx + hw, ly - spring), w - Math.hypot(lx - hw, ly - spring));
}

/** Warm glass, as in the mockup: three tints, deeper at the top. */
export function glassTint(tone: number, t: number): [number, number, number] {
  const pair = tone < 0.2 ? ['#ff6a2c', '#ffb257'] : tone > 0.85 ? ['#ffc970', '#fff0b8'] : ['#ff9038', '#ffd27c'];
  const a = hex(pair[0]);
  const b = hex(pair[1]);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function opening(win: Win, lx: number, ly: number): number {
  if (win.kind === 'double') {
    // Two lights and an oculus under one containing arch.
    const lw = (win.w - 0.22 - 0.24) / 2;
    const off = (lw + 0.22) / 2;
    const lh = win.h - 0.62;
    const lights = Math.max(lancet(lx - off, ly, lw, lh), lancet(lx + off, ly, lw, lh));
    const oculus = 0.15 - Math.hypot(lx, ly - (lh + 0.13));
    return Math.max(lights, oculus);
  }
  return lancet(lx, ly, win.w, win.h);
}

export function windowAtlas(p: WindowAtlasParams): Atlas {
  const { albedo, height } = masonry(p);
  const S = p.size;
  const T = p.tile;
  const px = T / S;
  const emissive = makeImg(S, S, 3);
  const R = rng(p.seed + 1000);
  const dressed = hex(p.dressed);
  const dark = hex('#0b0e15');

  const [gx, gy] = p.grid;
  const cw = T / gx;
  const ch = T / gy;
  const wins: Win[] = [];
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const roll = R();
      const k = p.kinds;
      const kind: Kind | null = roll < k.lancet ? 'lancet' : roll < k.lancet + k.double ? 'double' : roll < k.lancet + k.double + k.slit ? 'slit' : null;
      const lr = R();
      const tone = R();
      const jx = (R() - 0.5) * 0.5;
      if (!kind) continue;
      const light = kind === 'slit' ? (lr < 0.3 ? 0.7 : 0) : lr < p.lit ? 1 : lr < p.lit + p.dim ? 0.42 : 0;
      const size = kind === 'lancet' ? [1.0, 2.6] : kind === 'double' ? [1.7, 2.9] : [0.16, 1.5];
      const sk = 0.92 + 0.16 * R();
      wins.push({ kind, x: (i + 0.5) * cw + jx, y: (j + 1) * ch - 1.0, w: size[0] * sk, h: size[1] * sk, light, tone });
    }
  }

  const sw = 0.26;
  for (const win of wins) {
    const x0 = Math.floor((win.x - win.w / 2 - sw - 0.2) / px);
    const x1 = Math.ceil((win.x + win.w / 2 + sw + 0.2) / px);
    const y0 = Math.floor((win.y - win.h - sw - 0.1) / px);
    const y1 = Math.ceil((win.y + 0.6) / px);
    const qs = win.kind === 'slit' ? 0 : 1;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const x = ((xx % S) + S) % S;
        const y = ((yy % S) + S) % S;
        const i = y * S + x;
        const lx = (xx + 0.5) * px - win.x;
        const ly = win.y - (yy + 0.5) * px;
        const u = (x + 0.5) / S;
        const v = (y + 0.5) / S;
        const d = opening(win, lx, ly);
        // The surround follows the outer arch; a double lancet fills the rest with a tympanum.
        const outer = win.kind === 'double' ? lancet(lx, ly, win.w, win.h) : d;
        let h = height.d[i];
        let c: [number, number, number] = [albedo.d[i * 3], albedo.d[i * 3 + 1], albedo.d[i * 3 + 2]];

        // Drip shadow under the sill.
        if (ly < -0.12 && ly > -0.6 && Math.abs(lx) < win.w / 2 + sw) {
          const k = 1 - 0.35 * smoothstep(-0.6, -0.12, ly);
          c = [c[0] * k, c[1] * k, c[2] * k];
        }
        // Sill.
        const sillW = win.w / 2 + sw + 0.06;
        if (qs && ly <= 0.02 && ly > -0.13 && Math.abs(lx) < sillW) {
          const edge = Math.min(sillW - Math.abs(lx), ly + 0.13, 0.02 - ly);
          h = 0.06 + 0.02 * smoothstep(0, 0.03, edge) + 0.002 * fbm(u, v, 512, 2, p.seed + 31);
          const k = 0.95 + 0.1 * fbm(u, v, 256, 2, p.seed + 32);
          c = [dressed[0] * k, dressed[1] * k, dressed[2] * k];
        } else if (outer > 0 && d <= 0) {
          const k = 0.72 + 0.1 * fbm(u, v, 64, 3, p.seed + 36);
          h = -0.03 + 0.002 * fbm(u, v, 384, 2, p.seed + 37);
          c = [dressed[0] * k, dressed[1] * k, dressed[2] * k];
        } else if (outer <= 0 && outer > -sw && ly > 0) {
          // Dressed surround: smoother, paler stones with their own joints.
          const spring = win.h - win.w * SQ3;
          let jd: number;
          if (ly < spring) {
            const course = 0.43;
            jd = Math.abs(ly - Math.round(ly / course) * course);
          } else {
            const a = Math.atan2(ly - spring, lx);
            const step = Math.PI / 9;
            jd = Math.abs(a - Math.round(a / step) * step) * Math.hypot(lx, ly - spring);
          }
          const joint = Math.min(jd, -outer, sw + outer);
          const face = smoothstep(0.004, 0.018, joint);
          h = lerp(-0.008, 0.03 + 0.01 * smoothstep(0, 0.06, joint) + 0.003 * fbm(u, v, 384, 3, p.seed + 33), face);
          const k = (0.9 + 0.16 * fbm(u, v, 64, 3, p.seed + 34)) * lerp(0.45, 1, face);
          c = [dressed[0] * k, dressed[1] * k, dressed[2] * k];
        } else if (d > 0) {
          const reveal = win.kind === 'slit' ? 0.03 : 0.07;
          if (d < reveal) {
            // The deep reveal: stone turning into the wall, in shadow.
            const t = d / reveal;
            h = lerp(0.0, -0.2, t);
            const k = lerp(0.5, 0.18, t);
            c = [dressed[0] * k, dressed[1] * k, dressed[2] * k];
          } else {
            // Leaded glass: diamond quarries and iron saddle bars.
            const a = lx / 0.17 + ly / 0.25;
            const b = lx / 0.17 - ly / 0.25;
            const la = Math.abs(a - Math.round(a)) * 0.17;
            const lb = Math.abs(b - Math.round(b)) * 0.17;
            const bar = Math.abs(ly - 0.25 - Math.round((ly - 0.25) / 0.6) * 0.6);
            const lead = qs ? Math.max(1 - smoothstep(0.005, 0.011, Math.min(la, lb)), 1 - smoothstep(0.009, 0.014, bar), 1 - smoothstep(0, 0.01, d - reveal)) : 0;
            const qa = Math.floor(a);
            const qb = Math.floor(b);
            const pane = 0.82 + 0.3 * hash01(qa, qb, p.seed + 35);
            h = -0.22 + 0.004 * lead;
            const t = clamp(ly / win.h, 0, 1);
            const glow = win.light * pane * (0.85 + 0.15 * (1 - Math.abs(lx) / (win.w / 2 + 1e-3))) * (1 - lead);
            const tint = glassTint(win.tone, t);
            if (win.light > 0) {
              const dimmed = win.light < 1 ? 0.75 : 1;
              emissive.d[i * 3] = tint[0] * glow;
              emissive.d[i * 3 + 1] = tint[1] * glow * dimmed;
              emissive.d[i * 3 + 2] = tint[2] * glow * dimmed * dimmed;
              c = [tint[0] * 0.3 * glow, tint[1] * 0.3 * glow, tint[2] * 0.3 * glow];
            } else {
              const k = (0.8 + 0.4 * pane) * (1 - lead * 0.6);
              c = [dark[0] * k, dark[1] * k, dark[2] * k];
            }
          }
        }
        height.d[i] = h;
        albedo.d[i * 3] = c[0];
        albedo.d[i * 3 + 1] = c[1];
        albedo.d[i * 3 + 2] = c[2];
      }
    }
  }
  return { albedo, height, emissive };
}
