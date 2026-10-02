import * as THREE from 'three';
import type { RouteData, Waypoint } from '../data';
import { clamp, lerp, smoothstep } from '../world/math';

/** The autofly loop: a closed centripetal Catmull-Rom curve through the waypoints, parameter t in [0, 1). */
export class Route {
  private curve: THREE.CatmullRomCurve3;
  private speeds: number[];
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(
    data: RouteData,
    private castleCentre: THREE.Vector3,
  ) {
    this.curve = new THREE.CatmullRomCurve3([], data.closed, 'centripetal');
    this.speeds = [];
    this.setWaypoints(data.waypoints);
  }

  /** Replace the waypoints in place, so everything holding this route follows the edit. */
  setWaypoints(waypoints: Waypoint[]) {
    this.curve.points = waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.speeds = waypoints.map((w) => w[3]);
  }

  get count(): number {
    return this.speeds.length;
  }

  /** Waypoint index → curve parameter. */
  tAt(index: number): number {
    return index / this.speeds.length;
  }

  point(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.curve.getPoint(((t % 1) + 1) % 1, out);
  }

  /** Cruise speed at t, interpolated between waypoints. */
  speed(t: number): number {
    const n = this.speeds.length;
    const f = (((t % 1) + 1) % 1) * n;
    const i = Math.floor(f);
    return lerp(this.speeds[i % n], this.speeds[(i + 1) % n], f - i);
  }

  /** Metres per unit of t at t. */
  rate(t: number): number {
    return Math.max(this.point(t + 0.0005, this.tmpA).distanceTo(this.point(t, this.tmpB)) / 0.0005, 1e-3);
  }

  /** Nearest of 900 samples. */
  nearest(pos: THREE.Vector3): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < 900; i++) {
      const t = i / 900;
      const d = this.point(t, this.tmpA).distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /**
   * Where autofly wants to look: 32 m ahead on the route, biased toward the castle on distant
   * legs so the long shots stay composed. Returns [yaw, pitch].
   */
  look(t: number, pos: THREE.Vector3): [number, number] {
    const ahead = this.point(t + 32 / this.rate(t), new THREE.Vector3()).sub(pos).normalize();
    const toC = this.castleCentre.clone().sub(pos);
    const dc = toC.length();
    toC.normalize();
    ahead.lerp(toC, 0.8 * smoothstep(150, 360, dc)).normalize();
    return [Math.atan2(-ahead.x, -ahead.z), Math.asin(clamp(ahead.y, -1, 1)) * 0.85];
  }
}
