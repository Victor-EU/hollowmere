import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { Manifest, Tier } from '../data/manifest';

// The processed textures in public/assets (tools/process.ts). Everything loads up front for now;
// streaming low-then-high resolution in priority order is M6.

export const TEXTURE_IDS = ['stone', 'tower-windows', 'slate', 'flagstone', 'hall-glass'] as const;
export type TextureId = (typeof TEXTURE_IDS)[number];

export interface TextureSet {
  /** Metres per repeat. */
  tile: number;
  roughness: number;
  metalness: number;
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  emissiveMap: THREE.Texture | null;
}

export type Library = Record<TextureId, TextureSet>;

/** Phones and tablets get the smaller tier until real tier detection lands (M6). */
export function pickTier(): Tier {
  return matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
}

const empty = (): TextureSet => ({ tile: 1, roughness: 0.9, metalness: 0, map: null, normalMap: null, emissiveMap: null });

/**
 * Load every texture in the manifest for `tier`. A missing manifest or texture is logged and left
 * null, so the world still renders, flat-coloured, rather than not at all.
 */
export async function loadLibrary(renderer: THREE.WebGLRenderer, tier: Tier): Promise<Library> {
  const lib = Object.fromEntries(TEXTURE_IDS.map((id) => [id, empty()])) as Library;
  const base = new URL('assets/', document.baseURI);
  let manifest: Manifest;
  try {
    const res = await fetch(new URL('manifest.json', base));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as Manifest;
  } catch (err) {
    console.error(`assets/manifest.json: ${(err as Error).message}; run npm run process`);
    return lib;
  }
  const loader = new KTX2Loader().detectSupport(renderer);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const jobs: Promise<void>[] = [];
  for (const id of TEXTURE_IDS) {
    const t = manifest.textures[id];
    if (!t) {
      console.error(`assets/manifest.json has no "${id}"; run npm run process`);
      continue;
    }
    const set = lib[id];
    set.tile = t.tile;
    set.roughness = t.roughness ?? set.roughness;
    set.metalness = t.metalness ?? set.metalness;
    for (const [name, slot] of [
      ['albedo', 'map'],
      ['normal', 'normalMap'],
      ['emissive', 'emissiveMap'],
    ] as const) {
      const m = t.maps[name];
      if (!m) continue;
      const url = new URL(m.tiers[tier].file, base).href;
      jobs.push(
        loader.loadAsync(url).then(
          (tex) => {
            tex.name = `${id}.${name}`;
            tex.colorSpace = m.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(1 / t.tile, 1 / t.tile);
            tex.anisotropy = anisotropy;
            set[slot] = tex;
          },
          (err: unknown) => console.error(`${url}: ${(err as Error).message ?? err}`),
        ),
      );
    }
  }
  await Promise.all(jobs);
  loader.dispose();
  return lib;
}
