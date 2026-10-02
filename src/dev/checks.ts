import * as THREE from 'three';
import type { RouteData, WorldData, Zone } from '../data';
import { CLEARANCE, insideColliders } from '../flight/flight';
import type { Route } from '../flight/route';
import type { Colliders } from '../world/castle';
import type { Heights } from '../world/heights';

export type Level = 'error' | 'warn';

export interface Problem {
  level: Level;
  /** Scene path or data file. */
  where: string;
  what: string;
}

/** Past this, a vertex is almost certainly a runaway value (camera far is 9 km). */
const FAR = 12000;

type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function pathOf(o: THREE.Object3D): string {
  const parts: string[] = [];
  for (let p: THREE.Object3D | null = o; p && !(p as THREE.Scene).isScene; p = p.parent) {
    const m = (p as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const mat = Array.isArray(m) ? m[0] : m;
    parts.push(p.name || (mat?.name ? `${p.type}(${mat.name})` : p.type));
  }
  return parts.reverse().join(' › ') || 'scene';
}

/** Index of the first non-finite component and how many there are, over the first `count` items. */
function scanFinite(attr: Attr, count = attr.count): { first: number; bad: number } {
  let first = -1;
  let bad = 0;
  if ((attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < attr.itemSize; k++) {
        if (!Number.isFinite(attr.getComponent(i, k))) {
          if (first < 0) first = i;
          bad++;
        }
      }
    }
  } else {
    const a = attr.array;
    const n = Math.min(a.length, count * attr.itemSize);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(a[i])) {
        if (first < 0) first = Math.floor(i / attr.itemSize);
        bad++;
      }
    }
  }
  return { first, bad };
}

function versionOf(attr: Attr): [object, number] {
  const ib = (attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (attr as THREE.InterleavedBufferAttribute).data : null;
  return ib ? [ib, ib.version] : [attr, (attr as THREE.BufferAttribute).version];
}

const finiteMatrix = (m: THREE.Matrix4) => m.elements.every(Number.isFinite);

function finiteUniform(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (v && typeof v === 'object') {
    const o = v as { isVector2?: boolean; isVector3?: boolean; isVector4?: boolean; isColor?: boolean; isMatrix3?: boolean; isMatrix4?: boolean; elements?: number[] };
    if (o.isMatrix3 || o.isMatrix4) return o.elements!.every(Number.isFinite);
    if (o.isVector2 || o.isVector3 || o.isVector4 || o.isColor) return Object.values(o).every((x) => typeof x !== 'number' || Number.isFinite(x));
    if (Array.isArray(v)) return v.every(finiteUniform);
  }
  return true;
}

/**
 * Finds geometry that would poison the frame: NaN or Infinity in any attribute, instance matrix,
 * object transform or shader uniform; zero-length normals (normalize() of zero is NaN on the GPU);
 * indices past the end; attributes shorter than the position buffer; runaway vertices.
 * A single NaN vertex in the mockup's ghost made bloom smear black blocks across the screen.
 *
 * Incremental: an attribute is only re-read when its version changed since the last scan, so it
 * can run every second over animated buffers (trails, bats, the wyrm).
 */
export class GeometryWatch {
  private versions = new WeakMap<object, number>();
  private seenMaterials = new WeakSet<THREE.Material>();
  private reported = new Set<string>();
  readonly problems: Problem[] = [];
  /** Totals from the last full scan. */
  stats = { objects: 0, geometries: 0, attributes: 0, vertices: 0 };

  /** Returns problems not seen before. `full` re-reads everything. */
  scan(root: THREE.Object3D, full = false): Problem[] {
    if (full) {
      this.versions = new WeakMap();
      this.seenMaterials = new WeakSet();
    }
    const fresh: Problem[] = [];
    const report = (level: Level, where: string, key: string, what: string) => {
      const id = `${where}|${key}`;
      if (this.reported.has(id)) return;
      this.reported.add(id);
      const p = { level, where, what };
      this.problems.push(p);
      fresh.push(p);
    };
    const geometries = new Set<THREE.BufferGeometry>();
    let objects = 0;
    let attributes = 0;
    let vertices = 0;
    root.updateMatrixWorld();

    const visit = (o: THREE.Object3D) => {
      // Dev overlays (the route editor's gizmo has million-metre guide lines) aren't the world.
      if (o.userData.devOverlay) return;
      check(o);
      for (const c of o.children) visit(c);
    };
    const check = (o: THREE.Object3D) => {
      objects++;
      if (!finiteMatrix(o.matrixWorld)) report('error', pathOf(o), 'matrix', 'non-finite transform (position, rotation or scale)');
      const light = o as THREE.Light;
      if (light.isLight && (!Number.isFinite(light.intensity) || !finiteUniform(light.color))) {
        report('error', pathOf(o), 'light', `light intensity or colour is not finite (${light.intensity})`);
      }

      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        if (this.seenMaterials.has(m) && !full) continue;
        this.seenMaterials.add(m);
        const u = (m as THREE.ShaderMaterial).uniforms;
        if (!u) continue;
        for (const [name, { value }] of Object.entries(u)) {
          if (!finiteUniform(value)) report('error', pathOf(o), `uniform:${name}`, `material "${m.name || m.type}" uniform ${name} is not finite`);
        }
      }

      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        for (const [label, attr] of [
          ['instanceMatrix', im.instanceMatrix],
          ['instanceColor', im.instanceColor],
        ] as const) {
          if (!attr) continue;
          const [key, ver] = versionOf(attr);
          if (this.versions.get(key) === ver) continue;
          this.versions.set(key, ver);
          const { first, bad } = scanFinite(attr, im.count);
          if (bad) report('error', pathOf(o), label, `${label}: ${bad} non-finite values, first at instance ${first}`);
        }
      }

      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!g?.isBufferGeometry || geometries.has(g)) return;
      geometries.add(g);
      const where = pathOf(o);
      const pos = g.getAttribute('position') as Attr | undefined;
      if (!pos) {
        report('error', where, 'position', 'geometry has no position attribute');
        return;
      }
      vertices += pos.count;
      let changed = false;
      let positionBad = false;
      const all: [string, Attr][] = Object.entries(g.attributes) as [string, Attr][];
      for (const [name, list] of Object.entries(g.morphAttributes)) list.forEach((a, i) => all.push([`morph ${name}[${i}]`, a as Attr]));
      for (const [name, attr] of all) {
        attributes++;
        const [key, ver] = versionOf(attr);
        if (this.versions.get(key) === ver) continue;
        this.versions.set(key, ver);
        changed = true;
        const { first, bad } = scanFinite(attr);
        if (bad) report('error', where, `attr:${name}`, `${name}: ${bad} non-finite values, first at vertex ${first}`);
        if (bad && attr === pos) positionBad = true;
        const instanced =
          (attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute ||
          !!((attr as THREE.InterleavedBufferAttribute).data as { isInstancedInterleavedBuffer?: boolean } | undefined)?.isInstancedInterleavedBuffer;
        if (!instanced && !name.startsWith('morph') && attr.count < pos.count) {
          report('error', where, `count:${name}`, `${name} has ${attr.count} items but position has ${pos.count}`);
        }
      }
      if (!changed && !full) return;

      // Which vertices triangles actually use: SphereGeometry, for one, leaves a seam vertex at
      // each pole that nothing draws, and computeVertexNormals() gives those a zero normal.
      const index = g.index;
      let used: Uint8Array | null = null;
      if (index) {
        used = new Uint8Array(pos.count);
        let max = 0;
        const a = index.array;
        for (let i = 0; i < a.length; i++) {
          const v = a[i];
          if (v > max) max = v;
          if (v < pos.count) used[v] = 1;
        }
        if (max >= pos.count) report('error', where, 'index', `index refers to vertex ${max}, but there are only ${pos.count}`);
        if ((o as THREE.Mesh).isMesh && index.count % 3) report('warn', where, 'index:3', `index count ${index.count} is not a multiple of 3`);
      }

      // Zero normals only matter where the shader reads them: not flat shading, unlit materials or points.
      const normal = g.getAttribute('normal') as Attr | undefined;
      const lit = (Array.isArray(mats) ? mats : [mats]).some(
        (m) => m && !(m as THREE.MeshStandardMaterial).flatShading && !(m as THREE.MeshBasicMaterial).isMeshBasicMaterial,
      );
      if (normal && (o as THREE.Mesh).isMesh && lit) {
        let zero = 0;
        let first = -1;
        for (let i = 0; i < normal.count; i++) {
          if (used && !used[i]) continue;
          if (Math.abs(normal.getX(i)) + Math.abs(normal.getY(i)) + Math.abs(normal.getZ(i)) < 1e-6) {
            if (first < 0) first = i;
            zero++;
          }
        }
        if (zero) report('error', where, 'normal:zero', `${zero} zero-length normals (NaN once normalised), first at vertex ${first}`);
      }

      // Bounds over non-finite positions are already reported (and three logs its own error).
      if (positionBad || im.isInstancedMesh) return;
      g.computeBoundingSphere();
      const s = g.boundingSphere!;
      if (s.center.length() + s.radius > FAR) report('warn', where, 'far', `geometry reaches ${Math.round(s.center.length() + s.radius)} m from the origin`);
    };
    visit(root);

    this.stats = { objects, geometries: geometries.size, attributes, vertices };
    return fresh;
  }
}

/** Per-sample state of the route line. */
export const Flag = { Ok: 0, Low: 1, Stone: 2, Outside: 3 } as const;
export type Flag = (typeof Flag)[keyof typeof Flag];

export interface RouteSamples {
  points: THREE.Vector3[];
  speeds: number[];
  flags: Flag[];
  /** Metres, and seconds at waypoint speed, for one loop. */
  length: number;
  duration: number;
  /** Lowest height above the clearance floor, and where. Negative means the ghost gets pushed up. */
  lowest: { margin: number; leg: number };
  problems: Problem[];
}

/**
 * Walks the route and flags where autofly would be pushed off it: under the ghost's ground
 * clearance (it floats up instead), through stone on legs not listed in `through`, past the soft
 * boundary or above the ceiling.
 */
export function sampleRoute(route: Route, data: RouteData, world: WorldData, heights: Heights, colliders: Colliders, perLeg = 40): RouteSamples {
  const n = route.count;
  const pts: THREE.Vector3[] = [];
  const speeds: number[] = [];
  const flags: Flag[] = [];
  const problems: Problem[] = [];
  const through = new Set(data.through);
  const { softRadius, ceiling } = world.bounds;
  const wp = (i: number) => new THREE.Vector3(...(data.waypoints[i % n].slice(0, 3) as [number, number, number]));
  let length = 0;
  let duration = 0;
  let lowest = { margin: Infinity, leg: 0 };

  for (let leg = 0; leg < n; leg++) {
    const passes = through.has((leg + 1) % n);
    const hallLeg = insideColliders(colliders, wp(leg)) === 'hall' || insideColliders(colliders, wp(leg + 1)) === 'hall';
    const worst = { low: 0, lowAt: null as THREE.Vector3 | null, stone: 0, out: 0 };
    for (let k = 0; k < perLeg; k++) {
      const t = (leg + k / perLeg) / n;
      const p = route.point(t);
      const s = route.speed(t);
      if (pts.length) {
        const d = p.distanceTo(pts[pts.length - 1]);
        length += d;
        duration += d / Math.max(s, 0.1);
      }
      const margin = p.y - (heights.ground(p.x, p.z) + CLEARANCE);
      if (margin < lowest.margin) lowest = { margin, leg };
      const inside = insideColliders(colliders, p);
      let f: Flag = Flag.Ok;
      if (Math.hypot(p.x, p.z) > softRadius || p.y > ceiling) {
        f = Flag.Outside;
        worst.out++;
      } else if (!passes && (inside === true || (inside === 'hall' && !hallLeg))) {
        f = Flag.Stone;
        worst.stone++;
      } else if (margin < 0) {
        f = Flag.Low;
        if (-margin > worst.low) {
          worst.low = -margin;
          worst.lowAt = p;
        }
      }
      pts.push(p);
      speeds.push(s);
      flags.push(f);
    }
    const name = `route leg ${leg}→${(leg + 1) % n}`;
    if (worst.lowAt) {
      problems.push({ level: 'warn', where: name, what: `dips ${worst.low.toFixed(1)} m under the ${CLEARANCE} m clearance near (${worst.lowAt.x.toFixed(0)}, ${worst.lowAt.z.toFixed(0)}); the ghost floats up off the route` });
    }
    if (worst.stone) problems.push({ level: 'warn', where: name, what: `passes through stone; list waypoint ${(leg + 1) % n} in "through" if that is meant` });
    if (worst.out) problems.push({ level: 'warn', where: name, what: 'leaves the soft boundary or goes above the ceiling' });
  }
  // Close the loop.
  const d = pts[0].distanceTo(pts[pts.length - 1]);
  length += d;
  duration += d / Math.max(speeds[0], 0.1);
  return { points: pts, speeds, flags, length, duration, lowest, problems };
}

/** Everything about the data files that loading doesn't already reject. */
export function checkData(world: WorldData, route: RouteData, zones: Zone[]): Problem[] {
  const problems: Problem[] = [];
  const walk = (v: unknown, path: string, where: string) => {
    if (typeof v === 'number' && !Number.isFinite(v)) problems.push({ level: 'error', where, what: `${path} is not a finite number` });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, where));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, where);
  };
  walk(world, '', 'data/world.json');
  for (const t of world.towers) {
    if (!(t.r > 0 && t.h > 0 && t.spire >= 0)) problems.push({ level: 'error', where: 'data/world.json', what: `tower "${t.name}" needs r > 0, h > 0, spire >= 0` });
  }

  const n = route.waypoints.length;
  route.waypoints.forEach((w, i) => {
    if (w[3] < 3 || w[3] > 30) problems.push({ level: 'warn', where: 'data/route.json', what: `waypoint ${i} speed ${w[3]} m/s is outside the usual 3–30` });
  });
  for (const i of route.through) {
    if (!Number.isInteger(i) || i < 0 || i >= n) problems.push({ level: 'error', where: 'data/route.json', what: `"through" lists missing waypoint ${i}` });
  }
  if (!route.closed) problems.push({ level: 'error', where: 'data/route.json', what: 'autofly expects a closed loop' });

  const layers = new Set(['choir', 'gate', 'heights', null]);
  for (const z of zones) {
    const where = `data/zones.json "${z.id}"`;
    walk(z.shape, 'shape', where);
    if (!layers.has(z.layer)) problems.push({ level: 'error', where, what: `unknown audio layer "${z.layer}"` });
    if (!(z.gain >= 0 && z.gain <= 2)) problems.push({ level: 'warn', where, what: `gain ${z.gain} is outside 0–2` });
    const s = z.shape;
    if (s.type === 'box' && s.min.some((v, i) => v >= s.max[i])) problems.push({ level: 'error', where, what: 'box min must be below max on every axis' });
    if (s.type === 'sphere' && !(s.radius > 0)) problems.push({ level: 'error', where, what: 'sphere radius must be positive' });
  }
  return problems;
}
