// Shapes of the JSON files in /data. Units are metres, y up, lake surface at y = 0.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Range = [number, number];

export interface RockColumn {
  center: Vec2;
  topRadius: number;
  bottomRadius: number;
  top: number;
  bottom: number;
  /** Noise offset, so the two columns don't share a silhouette. */
  seed: number;
}

export interface TowerData {
  name: string;
  at: Vec2;
  r: number;
  /** Shaft height above `towerBase` (or the perimeter base). */
  h: number;
  spire: number;
  pinnacles?: boolean;
}

export interface WallData {
  from: Vec2 | { perimeter: number };
  to: Vec2 | { perimeter: number };
  base: number;
  top: number;
  thickness: number;
}

export interface WarmLightData {
  name: string;
  at: Vec3;
  /** Candela-ish: warm lights use decay 1 (see src/world/lights.ts). */
  intensity: number;
  distance: number;
  color?: string;
  /** Relative flicker depth, 0 for steady. */
  flicker?: number;
}

export type BoxOrRing = { min: Vec3; max: Vec3 } | { ring: Range; y: Range };

export type MistBank = BoxOrRing & { count: number; size: Range; opacity: Range; tint?: number };

export interface GhostGroup {
  /** A named anchor ('gate', 'hall', 'pier') or a point. */
  home: 'gate' | 'hall' | 'pier' | Vec3;
  count: number;
  radius: Range;
  rise: Range;
  /** Orbit speed, rad/s. Negative orbits the other way. */
  speed: Range;
  scale: Range;
  /** Randomly flip each ghost's orbit direction. */
  eitherWay?: boolean;
}

export interface WorldData {
  plateau: number;
  terrain: { size: number; segments: number };
  cliff: RockColumn;
  outcrop: RockColumn;
  lake: { center: Vec2; radii: Vec2; bed: number };
  mountains: { inner: number; outer: number; peak: number };
  hall: { x: Vec2; z: Vec2; floor: number; wallHeight: number; ridge: number; bays: number };
  towerBase: number;
  towers: TowerData[];
  perimeter: {
    radius: number;
    base: number;
    towers: ({ angle: number } & Omit<TowerData, 'name' | 'at'>)[];
  };
  walls: {
    perimeter: { base: number; top: number; thickness: number; skip: Vec2[] };
    extra: WallData[];
  };
  viaduct: { from: Vec3; to: Vec3; spans: number };
  gate: { at: Vec3; stairs: number };
  boathouse: { from: Vec2; toward: Vec2 };
  cobwebs: { at: Vec3; size: number; yaw: number; roll: number }[];
  lights: {
    hemisphere: { sky: string; ground: string; intensity: number };
    moon: { color: string; intensity: number; shadowExtent: number; shadowMap: number };
    warm: WarmLightData[];
  };
  fog: { color: string; density: number };
  moon: { direction: Vec3; distance: number; size: number };
  castleCentre: Vec3;
  bounds: { softRadius: number; fogEnd: number; ceiling: number };
  life: {
    pumpkins: {
      clouds: { min: Vec3; max: Vec3; count: number; scale: Range }[];
      giant: { at: Vec3; scale: number };
      viaduct: { count: number; rise: Range; spread: number; scale: Range };
    };
    candles: number;
    bats: { center: Vec3; count: number }[];
    ghosts: GhostGroup[];
    wisps: { count: number; min: Vec3; max: Vec3; radius: Range; speed: Range };
    wyrm: { center: Vec3; radius: number; segments: number };
    mist: MistBank[];
  };
}

/** [x, y, z, speed] */
export type Waypoint = [number, number, number, number];

export interface RouteData {
  closed: boolean;
  waypoints: Waypoint[];
  /** Waypoints whose incoming leg is allowed to pass through solids. */
  through: number[];
  /** Deep-link names (?at=hall) to waypoint indices. */
  named: Record<string, number>;
}

export type ZoneShape =
  | { type: 'box'; min: Vec3; max: Vec3 }
  | { type: 'sphere'; center: Vec3; radius: number }
  | { type: 'altitude'; min: number };

export type AudioLayerName = 'choir' | 'gate' | 'heights';

export interface Zone {
  id: string;
  label: string | null;
  layer: AudioLayerName | null;
  gain: number;
  falloff: number;
  shape: ZoneShape;
}

export interface ZonesData {
  zones: Zone[];
}
