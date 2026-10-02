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

export type MistBank = BoxOrRing & {
  count: number;
  /** Billboard width, metres. */
  size: Range;
  /** Height as a fraction of the width; 0.42 if left out. Low banks hug the water. */
  aspect?: number;
  opacity: Range;
  tint?: number;
};

/** Something a wandering ghost wears or carries, so no two look quite alike. */
export type GhostLook = 'plain' | 'hat' | 'lantern' | 'chain' | 'long';

/** An idle action: drift through some points, then linger there facing something. */
export interface GhostIdle {
  /** Offsets from the group's home. One point to go and look; several to drift up a stair. */
  path: Vec3[];
  /** Offset from home to face while lingering; the way it was going if left out. */
  look?: Vec3;
}

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
  /** One per ghost, in order (repeating); 'plain' if left out. */
  looks?: GhostLook[];
  /** Idle actions besides pausing to sway. */
  idles?: GhostIdle[];
  /** Drift aside to let the player through (the two in the hall). */
  makeWay?: boolean;
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
    /** Half-width of the moon's shadow camera round the castle, and its map size. */
    moonShadow: { extent: number; mapSize: number };
    warm: WarmLightData[];
  };
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
    wyrm: { center: Vec3; radius: number };
    /**
     * The gate guardian: where it stands (on the ground), the point it faces, how near you must
     * come for the lantern to follow you, and the lantern's spotlight (decay 1, like the warm lights).
     */
    warden: { at: Vec2; facing: Vec2; reach: number; light: number };
    mist: MistBank[];
  };
}

/** data/look.json: how the world looks. Colours are sRGB hex; tuned live with the dev look panel. */
export interface LookData {
  grade: {
    exposure: number;
    /** Mix toward a smoothstep S-curve after tone mapping, 0..1. */
    contrast: number;
    saturation: number;
    /** Split tone: multipliers for the shadows and the highlights. */
    shadows: Vec3;
    highlights: Vec3;
    /** What black becomes on screen, so the night lifts to deep blue instead of black. */
    blacks: string;
    vignette: number;
    grain: number;
    /** Chromatic aberration at the edges. */
    aberration: number;
  };
  bloom: { strength: number; radius: number; threshold: number };
  /** Emissive intensities, tuned against the bloom; the hall glass also gets a tint toward amber. */
  emissive: { towerWindow: number; hallGlass: number; hallGlassTint: string; pumpkinFace: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  moonlight: { color: string; intensity: number };
  /** Cold skylight from the side away from the moon, so shadowed walls keep their stone. */
  fill: { color: string; intensity: number };
  /** Sky dome: gradient, a broad glow round the moon and a tighter halo. */
  sky: { zenith: string; horizon: string; glow: string; halo: string };
  fog: { color: string; density: number };
  water: {
    deep: string;
    /** Multiplies the reflection. */
    tint: Vec3;
    /** Reflectance looking straight down; it rises to 1 at grazing angles. */
    reflectivity: number;
    /** Ripple normal strength. */
    ripple: number;
    /** Ripple tile size, metres. */
    scale: number;
    /** How far the ripples bend the reflection. */
    distortion: number;
    /** The moon's glitter path. */
    glitter: number;
    /** Specular exponent of the glitter: higher is finer sparkle. */
    sharpness: number;
  };
  mist: {
    color: string;
    opacity: number;
    /** Metres over which mist fades out where it meets geometry (soft particles). */
    softness: number;
    /** Mist fades in between these distances from the camera, so flying through it never pops. */
    near: Range;
    /** Forward scatter: mist brightens looking toward the moon. */
    moonGlow: number;
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
