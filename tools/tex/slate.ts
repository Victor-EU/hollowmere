// Procedural roof slate: overlapping courses of split slates, each butt standing proud of the
// course below, with lichen and moss. The image's top is up the roof (towards the ridge).

import { hex, makeImg } from './image.ts';
import { bakeOcclusion, type Surface } from './masonry.ts';
import { clamp, fbm, hash01, lerp, rng, smoothstep } from './noise.ts';

export interface SlateParams {
  size: number;
  tile: number;
  seed: number;
  /** Visible course height (the exposure), metres. */
  exposure: number;
  /** Slate width range, metres. */
  width: [number, number];
  /** Gap between neighbouring slates, metres. */
  gap: number;
  /** How far each butt stands proud of the course below, metres. */
  step: number;
  colors: string[];
  jitter: number;
  lichen: { color: string; amount: number };
  moss: { color: string; amount: number };
}

export function slate(p: SlateParams): Surface {
  const { size: S, tile: T, seed } = p;
  const R = rng(seed);
  const rows = Math.max(1, Math.round(T / p.exposure));
  const ex = T / rows;
  // Each course: slate edges from 0 to T, shifted by about half a slate from the course above.
  const courses = Array.from({ length: rows }, () => {
    const edges = [0];
    while (edges[edges.length - 1] < T - p.width[0] * 0.5) edges.push(edges[edges.length - 1] + p.width[0] + (p.width[1] - p.width[0]) * R());
    const k = T / edges[edges.length - 1];
    return { edges: edges.map((e) => e * k), shift: R() * T };
  });
  const albedo = makeImg(S, S, 3);
  const height = makeImg(S, S, 1);
  const cols = p.colors.map(hex);
  const lich = hex(p.lichen.color);
  const moss = hex(p.moss.color);
  const per = (m: number) => Math.max(1, Math.round(m * T));

  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      // Butts are slightly ragged.
      const Y = (v + 0.5 / rows) * T + 0.012 * fbm(u, v, per(6), 3, seed + 1);
      const ci = ((Math.floor(Y / ex) % rows) + rows) % rows;
      const c = courses[ci];
      // 0 at the top of the exposure (under the course above), 1 at the butt.
      const t = Y / ex - Math.floor(Y / ex);
      const X = (((u * T - c.shift) % T) + T) % T;
      let si = 0;
      while (c.edges[si + 1] <= X) si++;
      const a = c.edges[si];
      const b = c.edges[si + 1];
      const r1 = hash01(ci, si, seed);
      const r2 = hash01(ci, si, seed + 5);
      const r3 = hash01(ci, si, seed + 9);
      // Distance to the slate's side edges, with rounded butt corners.
      const side = Math.min(X - a, b - X) - p.gap / 2;
      const toButt = (1 - t) * ex;
      const rc = 0.035;
      const dist = side < rc && toButt < rc ? rc - Math.hypot(rc - side, rc - toButt) : side;
      const inside = smoothstep(0, 0.006, dist);
      // Each slate tilts out towards its butt; some sit a little skew.
      const surface = p.step * (t * (0.75 + 0.5 * r2) + (r3 - 0.5) * 0.4) + 0.002 * fbm(u, v, per(20), 3, seed + 2);
      const h = lerp(-0.004, surface, inside);
      height.d[y * S + x] = h;

      const base = cols[Math.floor(r1 * cols.length) % cols.length];
      const lit = (1 + p.jitter * (r2 * 2 - 1)) * (1 + 0.12 * fbm(u + r1 * 7, v, per(4), 3, seed + 3)) * (0.92 + 0.16 * t);
      let r = base[0] * lit;
      let g = base[1] * lit;
      let bb = base[2] * lit;
      // Gaps are dark.
      r *= lerp(0.25, 1, inside);
      g *= lerp(0.25, 1, inside);
      bb *= lerp(0.25, 1, inside);
      // Lichen in round spots; moss along the butts where water sits.
      const spots = smoothstep(0.45, 0.62, fbm(u, v, per(3), 3, seed + 4)) * smoothstep(0.2, 0.5, fbm(u, v, per(18), 2, seed + 6));
      const kl = clamp(spots * p.lichen.amount * inside, 0, 1);
      r = lerp(r, lich[0], kl);
      g = lerp(g, lich[1], kl);
      bb = lerp(bb, lich[2], kl);
      const km = clamp(smoothstep(0.55, 1, t) * smoothstep(0.1, 0.45, fbm(u, v, per(1.5), 3, seed + 7)) * p.moss.amount, 0, 1);
      r = lerp(r, moss[0], km);
      g = lerp(g, moss[1], km);
      bb = lerp(bb, moss[2], km);
      const i = (y * S + x) * 3;
      albedo.d[i] = r;
      albedo.d[i + 1] = g;
      albedo.d[i + 2] = bb;
    }
  }
  bakeOcclusion(albedo, height, T / S, 1.2);
  return { albedo, height };
}
