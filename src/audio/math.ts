export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** MIDI note to Hz. Everything pitched sits in D minor so layers never clash. */
export const mtof = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
