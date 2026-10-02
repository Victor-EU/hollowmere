// Texture asset specs: prompts/<id>.yaml, shared by tools/generate.ts and tools/process.ts.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const PROMPTS = join(ROOT, 'prompts');
export const RAW = join(ROOT, 'assets/raw');
export const OUT = join(ROOT, 'public/assets');

export type Tier = 'desktop' | 'mobile';
export const TIERS: Tier[] = ['desktop', 'mobile'];
export type MapName = 'albedo' | 'normal' | 'emissive';

export interface MapSpec {
  encode: 'etc1s' | 'uastc';
  /** Size per tier: 2048, or '512x2048'. */
  tiers: Record<Tier, number | string>;
  /** Generated sources: relief in metres per unit of local luminance contrast. */
  fromLuminance?: number;
  /** Normal map strength multiplier. */
  strength?: number;
  /** Generated sources: which pixels are lit glass. */
  derive?: { minLuminance: number; minWarmth: number };
}

export interface AssetSpec {
  id: string;
  kind: 'material' | 'atlas' | 'glass';
  /** Metres per repeat; the kit's UVs are in metres. 1 for a texture mapped once. */
  tile: number;
  seamless: boolean;
  /** Streaming order, lowest first (design doc §12). */
  priority: number;
  roughness?: number;
  metalness?: number;
  generate: { size: string; prompt: string; quality?: string };
  /** 'synth', or a candidate id in assets/raw/<id>/. */
  source: string;
  synth: { type: string; [k: string]: unknown };
  maps: Partial<Record<MapName, MapSpec>>;
}

export interface StyleSpec {
  all: string;
  scene: string;
  material: string;
  model: string;
  quality: string;
}

export function readStyle(): StyleSpec {
  return parse(readFileSync(join(PROMPTS, '_style.yaml'), 'utf8')) as StyleSpec;
}

export function readSpecs(): AssetSpec[] {
  return readdirSync(PROMPTS)
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'))
    .sort()
    .map((f) => {
      const spec = parse(readFileSync(join(PROMPTS, f), 'utf8')) as AssetSpec;
      if (spec.id !== f.replace(/\.yaml$/, '')) throw new Error(`prompts/${f}: id "${spec.id}" should match the file name`);
      return spec;
    });
}

export function tierSize(v: number | string): { w: number; h: number } {
  if (typeof v === 'number') return { w: v, h: v };
  const m = /^(\d+)x(\d+)$/.exec(v);
  if (!m) throw new Error(`bad tier size "${v}"`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

/** The full prompt sent to the image model. */
export function fullPrompt(spec: AssetSpec, style: StyleSpec): string {
  const look = spec.seamless ? style.material : style.scene;
  return [style.all, look, spec.generate.prompt].join('\n\n');
}
