// The great hall's stained glass: one window opening (a pointed arch) holding two lights with a
// rose in the head. Amber quarries, ruby and gold medallions, a few cool accents, all leaded,
// with stone tracery between. Abstract patterns only, no figures.

import { hex, makeImg, type Img } from './image.ts';
import { lancet } from './windows.ts';
import { clamp, fbm, hash01, smoothstep } from './noise.ts';

export interface GlassParams {
  /** Texels across and down. */
  width: number;
  height: number;
  /** The opening in metres (the texture spans its bounding box). */
  span: number;
  rise: number;
  seed: number;
}

export interface Glass {
  albedo: Img;
  emissive: Img;
}

const C = {
  ember: hex('#c8571f'),
  amber: hex('#dc7f2c'),
  honey: hex('#e99c45'),
  gold: hex('#efb456'),
  pale: hex('#f6cf86'),
  ruby: hex('#93201a'),
  deep: hex('#6a1620'),
  teal: hex('#24675f'),
  blue: hex('#1f356f'),
  violet: hex('#4b2b66'),
  stone: hex('#5d5a54'),
  lead: hex('#0c0b0a'),
};

type RGB = [number, number, number];

export function stainedGlass(p: GlassParams): Glass {
  const { width: W, height: H, span, rise, seed } = p;
  const albedo = makeImg(W, H, 3);
  const emissive = makeImg(W, H, 3);
  const mull = 0.2;
  const lw = (span - mull - 0.3) / 2;
  const off = (lw + mull) / 2;
  const lh = rise - span * 0.62;
  const rose = { y: lh + (rise - lh) * 0.42, r: Math.min(span * 0.24, (rise - lh) * 0.36) };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lx = ((x + 0.5) / W - 0.5) * span;
      const ly = (1 - (y + 0.5) / H) * rise;
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      const i = (y * W + x) * 3;
      const outer = lancet(lx, ly, span, rise);
      let glass: RGB | null = null;
      let lead = 0;
      // Which opening are we in: a light, the rose, or stone tracery?
      const side = lx < 0 ? -1 : 1;
      const llx = lx - side * off;
      const dLight = lancet(llx, ly, lw, lh);
      const dRose = rose.r - Math.hypot(lx, ly - rose.y);
      if (dLight > 0) {
        lead = Math.max(lead, 1 - smoothstep(0.006, 0.018, dLight));
        // Border strip of small alternating panes.
        const border = 0.1;
        if (dLight < border) {
          const seg = Math.floor(ly / 0.16);
          glass = seg % 2 ? C.ruby : C.blue;
          lead = Math.max(lead, 1 - smoothstep(0.004, 0.01, Math.abs(ly / 0.16 - Math.round(ly / 0.16)) * 0.16), 1 - smoothstep(0.004, 0.01, Math.abs(dLight - border)));
        } else {
          // Registers: a medallion every 2.4 m, quarries between.
          const reg = 3.2;
          const cy = (Math.floor(ly / reg) + 0.5) * reg;
          const dm = Math.hypot(llx, ly - cy);
          const mr = Math.min(lw / 2 - border - 0.06, 0.5);
          const k = Math.floor(ly / reg);
          if (dm < mr && cy + mr < lh - 0.6) {
            lead = Math.max(lead, 1 - smoothstep(0.006, 0.016, Math.abs(dm - mr)));
            // An eight-point star in gold on ruby, with teal or violet at its heart.
            const a = Math.atan2(ly - cy, llx);
            const star = mr * (0.55 + 0.3 * Math.cos(a * 8 + k));
            if (dm < mr * 0.28) glass = (k + (side > 0 ? 1 : 0)) % 2 ? C.teal : C.violet;
            else if (dm < star) glass = C.honey;
            else glass = k % 3 === 1 ? C.deep : C.ruby;
            lead = Math.max(lead, 1 - smoothstep(0.004, 0.012, Math.abs(dm - star)), 1 - smoothstep(0.004, 0.012, Math.abs(dm - mr * 0.28)));
            const spoke = Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) * (Math.PI / 4) * dm;
            if (dm > mr * 0.28) lead = Math.max(lead, 1 - smoothstep(0.003, 0.009, spoke));
          } else {
            const qa = llx / 0.2 + ly / 0.3;
            const qb = llx / 0.2 - ly / 0.3;
            const la = Math.abs(qa - Math.round(qa)) * 0.2;
            const lb = Math.abs(qb - Math.round(qb)) * 0.2;
            lead = Math.max(lead, 1 - smoothstep(0.004, 0.011, Math.min(la, lb)));
            const h = hash01(Math.floor(qa), Math.floor(qb), seed);
            // Deeper and redder towards the head, paler low down, like the mockup's glass.
            const up = ly / rise + (h - 0.5) * 0.35;
            glass = h < 0.04 ? C.ruby : up > 0.7 ? C.ember : up > 0.4 ? C.amber : up > 0.15 ? C.honey : C.gold;
            if (h > 0.96) glass = C.pale;
          }
        }
      } else if (dRose > 0) {
        lead = Math.max(lead, 1 - smoothstep(0.006, 0.018, dRose));
        // A quatrefoil of gold in a ring of ruby and teal petals.
        const a = Math.atan2(ly - rose.y, lx);
        const d = rose.r - dRose;
        const foil = rose.r * (0.5 + 0.14 * Math.cos(a * 4));
        if (d < foil) glass = d < rose.r * 0.16 ? C.ruby : C.honey;
        else glass = Math.floor((a / (Math.PI * 2)) * 12 + 12) % 2 ? C.teal : C.ruby;
        lead = Math.max(lead, 1 - smoothstep(0.004, 0.012, Math.abs(d - foil)), 1 - smoothstep(0.004, 0.012, Math.abs(d - rose.r * 0.16)));
        const spoke = Math.abs((((a / (Math.PI / 6)) % 1) + 1) % 1 - 0.5) * (Math.PI / 6) * d;
        if (d > foil) lead = Math.max(lead, 1 - smoothstep(0.004, 0.01, spoke));
      }
      // Iron saddle bars across the lights.
      if (glass && dLight > 0) {
        const bar = Math.abs(ly - 0.3 - Math.round((ly - 0.3) / 0.75) * 0.75);
        lead = Math.max(lead, 1 - smoothstep(0.01, 0.016, bar));
      }

      if (glass && outer > 0) {
        // Old glass is uneven: each pane a little lighter or darker, streaky within.
        const wob = 0.82 + 0.22 * fbm(u, v, 24, 3, seed + 1) + 0.08 * fbm(u * 4, v, 64, 2, seed + 2);
        // Candlelight from inside is strongest low in the window.
        const glow = clamp(wob * (0.8 + 0.25 * (1 - ly / rise)), 0, 1.3) * (1 - lead);
        for (let k = 0; k < 3; k++) {
          emissive.d[i + k] = glass[k] * glow;
          albedo.d[i + k] = glass[k] * 0.3 * glow + C.lead[k] * lead;
        }
      } else if (outer > 0) {
        // Tracery: pale stone, shaded towards its edges.
        const edge = Math.min(-dLight, -dRose);
        const k = (0.55 + 0.45 * smoothstep(0, 0.08, edge)) * (0.9 + 0.15 * fbm(u, v, 32, 3, seed + 3));
        for (let c = 0; c < 3; c++) albedo.d[i + c] = C.stone[c] * k;
      } else {
        for (let c = 0; c < 3; c++) albedo.d[i + c] = C.stone[c] * 0.5;
      }
    }
  }
  return { albedo, emissive };
}
