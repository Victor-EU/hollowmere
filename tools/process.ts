// Turn texture sources into the KTX2 files the app ships, plus public/assets/manifest.json.
//
//   node tools/process.ts [id ...] [--force]
//
// For each prompts/<id>.yaml: take its source (the procedural stand-in, or the generated candidate
// named by `source:`), check that it tiles, derive normal and emissive maps where it has none, and
// encode every map at every tier: ETC1S for albedo, UASTC for normals and emissive masks
// (design doc §11). Each map also gets a small WebP preview, a quarter of the mobile tier's size,
// which the app draws its first frame with while the KTX2 files stream in (§12). Assets whose spec,
// source and tools haven't changed are skipped.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emissiveFromAlbedo, heightFromLuminance } from './tex/derive.ts';
import sharp from 'sharp';
import { halve, normalFromHeight, readRgb, seamRatio, toRGBA8, writeHeightPng, writePng, type Img } from './tex/image.ts';
import { encodeKtx2 } from './tex/ktx2.ts';
import type { Manifest, ManifestTexture, TierFile } from '../src/data/manifest.ts';
import { OUT, RAW, ROOT, TIERS, readSpecs, tierSize, type AssetSpec, type MapName, type Tier } from './tex/spec.ts';
import { synthesize, type Maps } from './tex/synth.ts';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const MANIFEST = join(OUT, 'manifest.json');
const TEX = join(OUT, 'tex');

/** The synth module behind each `synth.type`. */
const SYNTH_FILES: Record<string, string> = { masonry: 'masonry.ts', windows: 'windows.ts', slate: 'slate.ts', glass: 'glass.ts' };

/** A file in tools/tex/ plus everything it imports from there, transitively. */
function texDeps(roots: string[]): string[] {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(join(ROOT, 'tools/tex', f), 'utf8');
    for (const m of src.matchAll(/from '\.\/([\w-]+\.ts)'/g)) visit(m[1]);
  };
  roots.forEach(visit);
  return [...seen].sort();
}

/**
 * Everything that changes an asset's output: its spec, its source pixels, and the code in
 * tools/tex/ that touches it (its synth module, filtering, encoder settings). Editing one synth
 * module only re-encodes the assets that use it. This file only orchestrates, so it isn't hashed.
 */
function hashOf(spec: AssetSpec): string {
  const h = createHash('sha256');
  h.update(JSON.stringify(spec));
  const roots = ['ktx2.ts', 'image.ts', 'derive.ts'];
  if (spec.source === 'synth') roots.push(SYNTH_FILES[spec.synth.type] ?? 'synth.ts');
  for (const f of texDeps(roots)) h.update(readFileSync(join(ROOT, 'tools/tex', f)));
  if (spec.source !== 'synth') {
    for (const f of sourceFiles(spec)) if (existsSync(f)) h.update(readFileSync(f));
  }
  return h.digest('hex').slice(0, 16);
}

function sourceFiles(spec: AssetSpec) {
  const base = join(RAW, spec.id, spec.source);
  return [`${base}.png`, `${base}.emissive.png`];
}

/** The largest size any map needs; every tier must be a power-of-two step down from it. */
function fullSize(spec: AssetSpec) {
  let w = 0;
  let h = 0;
  for (const m of Object.values(spec.maps)) {
    for (const t of TIERS) {
      const s = tierSize(m!.tiers[t]);
      w = Math.max(w, s.w);
      h = Math.max(h, s.h);
    }
  }
  return { w, h };
}

function shrink(img: Img, w: number, h: number, wrap: boolean): Img {
  let out = img;
  while (out.w > w || out.h > h) {
    if (out.w / w !== out.h / h) throw new Error(`can't shrink ${out.w}x${out.h} to ${w}x${h} keeping the aspect`);
    out = halve(out, wrap);
  }
  if (out.w !== w || out.h !== h) throw new Error(`can only shrink by powers of two (${img.w}x${img.h} -> ${w}x${h})`);
  return out;
}

async function loadSource(spec: AssetSpec): Promise<Maps> {
  const { w, h } = fullSize(spec);
  if (spec.source === 'synth') {
    const maps = synthesize(spec, w, h);
    // Keep a viewable copy next to the generated candidates, for curation.
    const dir = join(RAW, spec.id);
    mkdirSync(dir, { recursive: true });
    await writePng(join(dir, 'synth.png'), maps.albedo);
    if (maps.emissive) await writePng(join(dir, 'synth.emissive.png'), maps.emissive);
    if (maps.height) await writeHeightPng(join(dir, 'synth.height.png'), maps.height, -0.05, 0.08);
    return maps;
  }
  const [png, emissivePng] = sourceFiles(spec);
  if (!existsSync(png)) throw new Error(`${spec.id}: source "${spec.source}" not found at ${png}`);
  const albedo = await readRgb(png, { w, h, tile: spec.seamless });
  const maps: Maps = { albedo };
  if (existsSync(emissivePng)) maps.emissive = await readRgb(emissivePng, { w, h, tile: spec.seamless });
  return maps;
}

/** Previews are a quarter of the mobile tier, and no smaller than 32 px. */
const PREVIEW = 4;

async function writePreview(path: string, img: Img, srgb: boolean): Promise<number> {
  const out = await sharp(toRGBA8(img, srgb), { raw: { width: img.w, height: img.h, channels: 4 } })
    .removeAlpha()
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
  writeFileSync(path, out);
  return out.length;
}

/**
 * Encode every map of an asset. With `keep` (the manifest entry from a run whose KTX2 files are
 * still current) only the previews are written, since the KTX2 encode is the slow part.
 */
async function processAsset(spec: AssetSpec, hash: string, keep?: ManifestTexture): Promise<ManifestTexture> {
  const t0 = performance.now();
  const src = await loadSource(spec);
  if (spec.seamless) {
    const r = seamRatio(src.albedo);
    if (r > 2) throw new Error(`${spec.id}: the source doesn't tile (seam ratio ${r.toFixed(2)}); make it seamless first`);
  }
  const wrap = spec.seamless;
  const entry: ManifestTexture = {
    kind: spec.kind,
    tile: spec.tile,
    priority: spec.priority,
    roughness: spec.roughness,
    metalness: spec.metalness,
    source: spec.source,
    hash,
    maps: {},
  };
  const sizes: string[] = [];
  for (const [name, m] of Object.entries(spec.maps) as [MapName, NonNullable<AssetSpec['maps'][MapName]>][]) {
    let full: Img;
    if (name === 'albedo') full = src.albedo;
    else if (name === 'emissive') {
      full = src.emissive ?? emissiveFromAlbedo(src.albedo, m.derive?.minLuminance ?? 0.35, m.derive?.minWarmth ?? 0.25);
    } else {
      full = src.height ?? heightFromLuminance(src.albedo, spec.tile, m.fromLuminance ?? 0.03);
    }
    const srgb = name !== 'normal';
    const small = tierSize(m.tiers.mobile);
    const pw = Math.max(32, small.w / PREVIEW);
    const ph = Math.max(32, small.h / PREVIEW);
    let pimg = shrink(full, pw, ph, wrap);
    if (name === 'normal') pimg = normalFromHeight(pimg, spec.tile / pw, m.strength ?? 1, wrap);
    const pfile = `tex/${spec.id}.${name}.${pw === ph ? pw : `${pw}x${ph}`}.webp`;
    const preview: TierFile = { file: pfile, width: pw, height: ph, bytes: await writePreview(join(OUT, pfile), pimg, srgb) };
    sizes.push(`${name}@preview ${(preview.bytes / 1024).toFixed(0)}K`);
    const kept = keep?.maps[name];
    if (kept) {
      entry.maps[name] = { srgb, preview, tiers: kept.tiers };
      continue;
    }
    const tiers = {} as Record<Tier, TierFile>;
    for (const tier of TIERS) {
      const { w, h } = tierSize(m.tiers[tier]);
      let img = shrink(full, w, h, wrap);
      if (name === 'normal') img = normalFromHeight(img, spec.tile / w, m.strength ?? 1, wrap);
      const data = await encodeKtx2(img, { mode: m.encode, srgb, normalMap: name === 'normal' });
      const file = `tex/${spec.id}.${name}.${w === h ? w : `${w}x${h}`}.ktx2`;
      writeFileSync(join(OUT, file), data);
      tiers[tier] = { file, width: w, height: h, bytes: data.length };
      sizes.push(`${name}@${tier} ${(data.length / 1024).toFixed(0)}K`);
    }
    entry.maps[name] = { srgb, preview, tiers };
  }
  console.log(`${spec.id}: ${sizes.join(', ')} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  return entry;
}

mkdirSync(TEX, { recursive: true });
const manifest: Manifest = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest)
  : { note: '', textures: {} };
manifest.note = 'Written by tools/process.ts (textures) and tools/stems.ts (stems). Do not edit by hand.';
const specs = readSpecs();
const ids = new Set(specs.map((s) => s.id));
for (const id of only) if (!ids.has(id)) throw new Error(`no prompts/${id}.yaml`);
for (const id of Object.keys(manifest.textures)) if (!ids.has(id)) delete manifest.textures[id];

for (const spec of specs) {
  if (only.length && !only.includes(spec.id)) continue;
  const hash = hashOf(spec);
  const old = manifest.textures[spec.id];
  const intact = old && Object.values(old.maps).every((m) => TIERS.every((t) => existsSync(join(OUT, m!.tiers[t].file))));
  const previews = old && Object.values(old.maps).every((m) => m!.preview && existsSync(join(OUT, m!.preview.file)));
  const current = !force && old?.hash === hash && intact;
  if (current && previews) {
    console.log(`${spec.id}: up to date`);
    continue;
  }
  manifest.textures[spec.id] = await processAsset(spec, hash, current ? old : undefined);
  // Save as we go, so an interrupted run keeps what it finished.
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

// Drop files nothing refers to any more.
const used = new Set(
  Object.values(manifest.textures).flatMap((t) => Object.values(t.maps).flatMap((m) => [m!.preview.file, ...TIERS.map((tier) => m!.tiers[tier].file)])),
);
for (const f of readdirSync(TEX)) if (!used.has(`tex/${f}`)) rmSync(join(TEX, f));

const total = (tier: Tier) =>
  Object.values(manifest.textures).reduce((n, t) => n + Object.values(t.maps).reduce((m, map) => m + map!.tiers[tier].bytes, 0), 0);
const previewBytes = Object.values(manifest.textures).reduce((n, t) => n + Object.values(t.maps).reduce((m, map) => m + map!.preview.bytes, 0), 0);
console.log(
  `textures: desktop ${(total('desktop') / 1048576).toFixed(1)} MB, mobile ${(total('mobile') / 1048576).toFixed(1)} MB, previews ${(previewBytes / 1024).toFixed(0)} KB`,
);
