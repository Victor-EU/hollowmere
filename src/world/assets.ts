import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { Manifest, ManifestTexture, MapName, Tier, TierFile } from '../data/manifest';

// The processed textures in public/assets (tools/process.ts), streamed as design doc §12 lays out:
// the manifest and a small WebP preview of every map are all the first frame waits for, then the
// tier's KTX2 files follow in priority order and sharpen into place.

export const TEXTURE_IDS = ['stone', 'tower-windows', 'slate', 'flagstone', 'hall-glass'] as const;
export type TextureId = (typeof TEXTURE_IDS)[number];

type Slot = 'map' | 'normalMap' | 'emissiveMap';
const SLOTS: readonly [MapName, Slot][] = [
  ['albedo', 'map'],
  ['normal', 'normalMap'],
  ['emissive', 'emissiveMap'],
];

/** Seconds a set takes to sharpen from its preview to full resolution. */
const SHARPEN = 0.9;

/** A 1x1 texture: what a map shows before its preview arrives. */
function solid(r: number, g: number, b: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Before its preview, albedo is white under the material's flat colour, normals are flat and
 * emissive is dark. Every listed map has some texture from the start, so the materials' shaders
 * never change as the real ones arrive.
 */
const STAND_INS: Record<MapName, THREE.Texture> = {
  albedo: solid(255, 255, 255, true),
  normal: solid(128, 128, 255, false),
  emissive: solid(0, 0, 0, true),
};

interface Bound {
  material: THREE.MeshStandardMaterial;
  /** Shown until the albedo preview arrives. */
  flat: THREE.Color;
}

interface Sharpening {
  textures: THREE.Texture[];
  /** Starting minimum mip level per texture: what the preview's resolution amounts to. */
  from: number[];
  t: number;
}

/** Surface settings for one texture set, known once the manifest has loaded. */
export interface SetInfo {
  /** Metres per repeat. */
  tile: number;
  roughness: number;
  metalness: number;
  maps: MapName[];
}

export class TextureLibrary {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly base: URL;
  private readonly entries: Partial<Record<TextureId, ManifestTexture>>;
  private readonly current = new Map<string, THREE.Texture>();
  private readonly bound = new Map<TextureId, Bound[]>();
  private readonly fading: Sharpening[] = [];
  private readonly anisotropy: number;
  private readonly previewsLoaded: Promise<void>;
  private streaming: Promise<void> | null = null;
  /** Bytes of KTX2 fetched, for the stats overlay. */
  streamed = 0;

  private constructor(renderer: THREE.WebGLRenderer, base: URL, manifest: Manifest | null) {
    this.renderer = renderer;
    this.base = base;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.entries = {};
    for (const id of TEXTURE_IDS) {
      const t = manifest?.textures[id];
      if (t) this.entries[id] = t;
      else if (manifest) console.error(`assets/manifest.json has no "${id}"; run npm run process`);
    }
    this.previewsLoaded = this.loadPreviews();
  }

  /** Fetch the manifest and start on the previews. Without a manifest, materials keep flat colours. */
  static async open(renderer: THREE.WebGLRenderer): Promise<TextureLibrary> {
    const base = new URL('assets/', document.baseURI);
    let manifest: Manifest | null = null;
    try {
      const res = await fetch(new URL('manifest.json', base));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = (await res.json()) as Manifest;
    } catch (err) {
      console.error(`assets/manifest.json: ${(err as Error).message}; run npm run process`);
    }
    return new TextureLibrary(renderer, base, manifest);
  }

  info(id: TextureId): SetInfo {
    const t = this.entries[id];
    return {
      tile: t?.tile ?? 1,
      roughness: t?.roughness ?? 0.9,
      metalness: t?.metalness ?? 0,
      maps: t ? SLOTS.map(([name]) => name).filter((n) => t.maps[n]) : [],
    };
  }

  /** Give `material` set `id`'s maps, now and as better ones arrive. It shows `flat` until its albedo does. */
  bind(material: THREE.MeshStandardMaterial, id: TextureId, flat: THREE.ColorRepresentation): void {
    const b: Bound = { material, flat: new THREE.Color(flat) };
    const list = this.bound.get(id) ?? [];
    list.push(b);
    this.bound.set(id, list);
    for (const [name] of SLOTS) if (this.entries[id]?.maps[name]) this.apply(id, name, b);
    // The emissive map is the colour; tinting it is the material's business afterwards.
    if (this.entries[id]?.maps.emissive) material.emissive.set(0xffffff);
  }

  /** Resolves once every preview has loaded or failed, or after `timeout` ms, whichever is first. */
  previews(timeout: number): Promise<void> {
    return Promise.race([this.previewsLoaded, new Promise<void>((r) => setTimeout(r, timeout))]);
  }

  /** Fetch the full-resolution maps for `tier`, highest priority first, each set sharpening into place as it lands. */
  stream(tier: Tier): Promise<void> {
    this.streaming ??= this.loadTier(tier);
    return this.streaming;
  }

  /** Advance the sharpening; once a frame. */
  update(dt: number): void {
    if (!this.fading.length) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    for (const f of [...this.fading]) {
      f.t = Math.min(1, f.t + dt / SHARPEN);
      const k = 1 - f.t * f.t * (3 - 2 * f.t);
      f.textures.forEach((tex, i) => {
        // Bound through three's state tracking, so it knows what's bound where afterwards.
        const props = this.renderer.properties.get(tex) as { __webglTexture?: WebGLTexture };
        if (!props.__webglTexture) this.renderer.initTexture(tex);
        this.renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture!);
        gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_LOD, f.t < 1 ? f.from[i] * k : -1000);
        this.renderer.state.unbindTexture();
      });
      if (f.t >= 1) this.fading.splice(this.fading.indexOf(f), 1);
    }
  }

  private key(id: TextureId, name: MapName) {
    return `${id}.${name}`;
  }

  private apply(id: TextureId, name: MapName, b: Bound) {
    const slot = SLOTS.find(([n]) => n === name)![1];
    const tex = this.current.get(this.key(id, name)) ?? STAND_INS[name];
    b.material[slot] = tex;
    if (name === 'albedo') b.material.color.copy(tex === STAND_INS.albedo ? b.flat : new THREE.Color(0xffffff));
  }

  /** Make `tex` the map shown for (id, name) everywhere it's bound, and let go of the one it replaces. */
  private show(id: TextureId, name: MapName, tex: THREE.Texture) {
    const k = this.key(id, name);
    const old = this.current.get(k);
    this.current.set(k, tex);
    for (const b of this.bound.get(id) ?? []) this.apply(id, name, b);
    if (old && old !== tex) old.dispose();
  }

  private prepare(tex: THREE.Texture, id: TextureId, name: MapName, srgb: boolean) {
    const t = this.entries[id]!;
    tex.name = this.key(id, name);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / t.tile, 1 / t.tile);
    tex.anisotropy = this.anisotropy;
  }

  private async loadPreviews(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const jobs: Promise<void>[] = [];
    for (const [id, t] of Object.entries(this.entries) as [TextureId, ManifestTexture][]) {
      for (const [name, m] of Object.entries(t.maps) as [MapName, NonNullable<ManifestTexture['maps'][MapName]>][]) {
        if (!m.preview) continue;
        const url = new URL(m.preview.file, this.base).href;
        jobs.push(
          loader.loadAsync(url).then(
            (tex) => {
              this.prepare(tex, id, name, m.srgb);
              // A full-resolution map may have beaten a slow preview here.
              if (!this.current.has(this.key(id, name))) this.show(id, name, tex);
              else tex.dispose();
            },
            () => console.warn(`${url}: preview didn't load; the full map will`),
          ),
        );
      }
    }
    await Promise.all(jobs);
  }

  private async loadTier(tier: Tier): Promise<void> {
    const loader = new KTX2Loader().detectSupport(this.renderer);
    const sets = (Object.entries(this.entries) as [TextureId, ManifestTexture][]).sort((a, b) => a[1].priority - b[1].priority);
    // Two sets in flight: enough to keep the connection busy without starving the first.
    let next = 0;
    const worker = async () => {
      while (next < sets.length) {
        const [id, t] = sets[next++];
        await this.loadSet(loader, id, t, tier);
      }
    };
    await Promise.all([worker(), worker()]);
    loader.dispose();
  }

  private async loadSet(loader: KTX2Loader, id: TextureId, t: ManifestTexture, tier: Tier) {
    const maps = Object.entries(t.maps) as [MapName, NonNullable<ManifestTexture['maps'][MapName]>][];
    const loaded = await Promise.all(
      maps.map(async ([name, m]) => {
        const file: TierFile = m.tiers[tier];
        const url = new URL(file.file, this.base).href;
        try {
          const tex = await loader.loadAsync(url);
          this.streamed += file.bytes;
          this.prepare(tex, id, name, m.srgb);
          return { name, tex, file, preview: m.preview };
        } catch (err) {
          console.error(`${url}: ${(err as Error).message ?? err}`);
          return null;
        }
      }),
    );
    // Swap the whole set at once, then sharpen it from whatever was showing: the preview's
    // resolution, or its coarsest mip (its average colour) if the preview never came.
    const fade: Sharpening = { textures: [], from: [], t: 0 };
    for (const l of loaded) {
      if (!l) continue;
      const shown = this.current.get(this.key(id, l.name));
      const from = shown && l.preview && (shown.image as { width?: number } | null)?.width === l.preview.width ? Math.log2(l.file.width / l.preview.width) : Math.log2(Math.max(l.file.width, l.file.height));
      this.renderer.initTexture(l.tex);
      fade.textures.push(l.tex);
      fade.from.push(from);
      this.show(id, l.name, l.tex);
    }
    if (fade.textures.length) {
      this.fading.push(fade);
      this.update(0);
    }
  }
}
