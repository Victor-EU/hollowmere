import type { RockColumn, Vec2, WorldData } from '../data';
import { clamp, fbm, lerp, ridged, smoothstep } from './math';

/**
 * Analytic heights. The terrain mesh, tree placement and the flight model all read from here,
 * so what you see is what you float over.
 */
export class Heights {
  constructor(private world: WorldData) {}

  /** Land, mountains and lake bed, without the rock columns. */
  terrain(x: number, z: number): number {
    const { lake, mountains: m } = this.world;
    let h = fbm(x * 0.0045 + 3.1, z * 0.0045 - 1.7, 4) * 26 + 8;
    const r = Math.hypot(x, z);
    const north = 0.6 + 0.4 * Math.max(0, -z / (r + 1));
    const ring = smoothstep(m.inner, m.outer, r);
    h += ring * (ridged(x * 0.0022 + 5, z * 0.0022 + 9, 5) * m.peak * north + 40);
    const lx = (x - lake.center[0]) / lake.radii[0];
    const lz = (z - lake.center[1]) / lake.radii[1];
    const water = 1 - smoothstep(0.72, 1.02, Math.sqrt(lx * lx + lz * lz));
    return h * (1 - water) + lake.bed * water;
  }

  /** Approximate top surface of a rock column's tapered side, or -Infinity outside it. */
  private column(col: RockColumn, x: number, z: number, slack: number): number {
    const d = Math.hypot(x - col.center[0], z - col.center[1]);
    if (d >= col.bottomRadius) return -Infinity;
    const t = (col.bottomRadius - d) / (col.bottomRadius - col.topRadius + slack);
    return clamp(col.bottom + (col.top - col.bottom) * t, -50, col.top);
  }

  /** What the ghost floats above: terrain, water surface or rock. */
  ground(x: number, z: number): number {
    const { cliff, outcrop } = this.world;
    return Math.max(this.terrain(x, z), 0, this.column(cliff, x, z, 2), this.column(outcrop, x, z, 1));
  }

  /** Walk from `from` toward `toward` until the terrain leaves the water. */
  shore(from: Vec2, toward: Vec2): Vec2 {
    for (let t = 0; t <= 1; t += 0.005) {
      const x = lerp(from[0], toward[0], t);
      const z = lerp(from[1], toward[1], t);
      if (this.terrain(x, z) > 1.2) return [x, z];
    }
    return [toward[0], toward[1]];
  }
}
