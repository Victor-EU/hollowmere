// Shape of public/assets/manifest.json, written by tools/process.ts.

export type Tier = 'desktop' | 'mobile';
export type MapName = 'albedo' | 'normal' | 'emissive';

export interface TierFile {
  /** Relative to public/assets/. */
  file: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ManifestTexture {
  kind: 'material' | 'atlas' | 'glass';
  /** Metres per repeat; the castle kit's UVs are in metres. */
  tile: number;
  /** Streaming order, lowest first (design doc §12). */
  priority: number;
  roughness?: number;
  metalness?: number;
  /** 'synth' for the procedural stand-in, otherwise the generated candidate that shipped. */
  source: string;
  hash: string;
  maps: Partial<Record<MapName, { srgb: boolean; tiers: Record<Tier, TierFile> }>>;
}

export interface Manifest {
  note: string;
  textures: Record<string, ManifestTexture>;
}
