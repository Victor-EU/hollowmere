import worldJson from '../../data/world.json';
import routeJson from '../../data/route.json';
import zonesJson from '../../data/zones.json';
import lookJson from '../../data/look.json';
import type { LookData, RouteData, WorldData, Zone, ZonesData } from './types';

export type * from './types';

function fail(file: string, message: string): never {
  throw new Error(`data/${file}: ${message}`);
}

function checkRoute(route: RouteData): RouteData {
  if (route.waypoints.length < 4) fail('route.json', 'needs at least 4 waypoints');
  route.waypoints.forEach((w, i) => {
    if (w.length !== 4 || !w.every(Number.isFinite)) fail('route.json', `waypoint ${i} must be [x, y, z, speed]`);
    if (w[3] <= 0) fail('route.json', `waypoint ${i} has a non-positive speed`);
  });
  for (const [name, i] of Object.entries(route.named)) {
    if (!route.waypoints[i]) fail('route.json', `named point "${name}" points at missing waypoint ${i}`);
  }
  return route;
}

function checkZones(data: ZonesData): ZonesData {
  const ids = new Set<string>();
  data.zones.forEach((z: Zone) => {
    if (ids.has(z.id)) fail('zones.json', `duplicate zone id "${z.id}"`);
    ids.add(z.id);
    if (z.falloff < 0) fail('zones.json', `zone "${z.id}" has a negative falloff`);
  });
  return data;
}

export const world = worldJson as unknown as WorldData;
export const route = checkRoute(routeJson as unknown as RouteData);
export const zones = checkZones(zonesJson as unknown as ZonesData).zones;
/** Live: the dev look panel edits it in place (see src/render/look.ts). */
export const look = lookJson as unknown as LookData;
