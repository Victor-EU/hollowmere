// Shape of public/assets/manifest.json, written by tools/process.ts.

export type Tier = 'desktop' | 'mobile';
export type MapName = 'albedo' | 'normal' | 'emissive';

/** A KTX2 file, or for `preview` a WebP a quarter of the mobile tier's size, drawn until the KTX2 arrives. */
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
  maps: Partial<Record<MapName, { srgb: boolean; tiers: Record<Tier, TierFile>; preview: TierFile }>>;
}

export interface StemFile {
  /** Relative to public/assets/. */
  file: string;
  bytes: number;
}

/** A composed music stem, written by tools/stems.ts. */
export interface ManifestStem {
  /** The mix layer it replaces. */
  layer: 'musicbox' | 'choir';
  /** Loops of equal length; the player picks a different one each time round. Opus, with AAC for browsers without it. */
  variants: { opus: StemFile; aac: StemFile }[];
  /** Seconds. The loop runs from loopStart for loopLength; the file holds the loop's own end before it and its start after. */
  loopStart: number;
  loopLength: number;
  /** Linear gain that matches the stem's loudness to the synth layer it replaces. */
  gain: number;
  /** Fetch order once sound is on, lowest first. */
  priority: number;
  /** 'score' when rendered from tools/stems/score.ts, 'master' for a composer's file in music/. */
  source: 'score' | 'master';
  hash: string;
}

export interface Manifest {
  note: string;
  textures: Record<string, ManifestTexture>;
  stems?: Record<string, ManifestStem>;
}
