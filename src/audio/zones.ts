import type { Zone, ZoneShape } from '../data';
import { smoothstep } from './math';

export interface Point3 { x: number; y: number; z: number }

/** Metres from p to the shape's surface; 0 inside. 'altitude' measures p.y against min. */
export function zoneDistance(shape: ZoneShape, p: Point3): number {
  switch (shape.type) {
    case 'box': {
      const [x0, y0, z0] = shape.min;
      const [x1, y1, z1] = shape.max;
      return Math.hypot(
        Math.max(x0 - p.x, 0, p.x - x1),
        Math.max(y0 - p.y, 0, p.y - y1),
        Math.max(z0 - p.z, 0, p.z - z1),
      );
    }
    case 'sphere': {
      const [cx, cy, cz] = shape.center;
      return Math.max(0, Math.hypot(p.x - cx, p.y - cy, p.z - cz) - shape.radius);
    }
    case 'altitude':
      return Math.max(0, shape.min - p.y);
  }
}

/** 0..zone.gain: zone.gain inside the shape, easing (smoothstep) to 0 over zone.falloff metres outside it. falloff 0 means a hard edge. 'altitude' measures p.y against min. */
export function zoneGain(zone: Zone, p: Point3): number {
  const d = zoneDistance(zone.shape, p);
  if (d <= 0) return zone.gain;
  if (d >= zone.falloff) return 0;
  return zone.gain * smoothstep(zone.falloff, 0, d);
}

/** Highest-gain labelled zone the point is inside (gain at full value), or null. Used by the HUD. */
export function zoneLabelAt(zones: Zone[], p: Point3): string | null {
  let best: Zone | null = null;
  for (const z of zones) {
    if (z.label === null || zoneDistance(z.shape, p) > 0) continue;
    if (!best || z.gain > best.gain) best = z;
  }
  return best ? best.label : null;
}
