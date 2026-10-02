// Generate texture candidates with OpenAI's image API (design doc §11).
//
//   node tools/generate.ts <id> [--n=4] [--model=name] [--dry-run]
//
// Needs OPENAI_API_KEY in your environment; it never goes in the repo or the app. Each call is
// billed to that key. Writes assets/raw/<id>/<candidate>.png with <candidate>.json beside it
// (prompt, model, size, date). Tileable assets are then made seamless: shifted by half a tile so
// the seams cross in the middle, that cross inpainted with the edits endpoint, and the result
// checked. To ship a candidate, set `source: <candidate>` in prompts/<id>.yaml and run
// `npm run process`. --dry-run prints the request instead of sending it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { readRgb, seamRatio } from './tex/image.ts';
import { RAW, fullPrompt, readSpecs, readStyle, type AssetSpec } from './tex/spec.ts';

const API = 'https://api.openai.com/v1/images';
const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const id = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry-run');
const count = Number(flag('n') ?? 4);

const spec = readSpecs().find((s) => s.id === id);
if (!spec) {
  console.error(`usage: node tools/generate.ts <id> [--n=4] [--model=name] [--dry-run]\nids: ${readSpecs().map((s) => s.id).join(', ')}`);
  process.exit(1);
}
const style = readStyle();
const model = flag('model') ?? process.env.OPENAI_IMAGE_MODEL ?? style.model;
const quality = spec.generate.quality ?? style.quality;
const prompt = fullPrompt(spec, style);
const request = { model, prompt, n: count, size: spec.generate.size, quality };

if (dry) {
  console.log(`POST ${API}/generations\n${JSON.stringify(request, null, 2)}`);
  if (spec.seamless) console.log(`then, per image: POST ${API}/edits to inpaint the seam cross`);
  process.exit(0);
}
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY is not set. It belongs in your shell environment, never in the repo.');
  process.exit(1);
}

async function images(res: Response): Promise<Buffer[]> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  const body = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  return Promise.all(
    body.data.map(async (d) => {
      if (d.b64_json) return Buffer.from(d.b64_json, 'base64');
      if (d.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
      throw new Error('the response had neither b64_json nor url');
    }),
  );
}

/** Shift by half a tile with wrap-around, so the seams form a cross through the middle. */
async function offsetHalf(png: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (((y + h / 2) % h) * w + ((x + w / 2) % w)) * 4;
      data.copy(out, (y * w + x) * 4, s, s + 4);
    }
  }
  return { data: out, w, h };
}

/** 0 inside the seam cross, 1 away from it, with a soft edge. */
function crossWeight(x: number, y: number, w: number, h: number, band: number): number {
  const d = Math.min(Math.abs(x + 0.5 - w / 2), Math.abs(y + 0.5 - h / 2));
  return Math.min(1, Math.max(0, (d - band) / (band * 0.5)));
}

async function makeSeamless(png: Buffer, a: AssetSpec): Promise<{ png: Buffer; before: number; after: number }> {
  const before = seamRatio(await readRgb(png));
  const { data, w, h } = await offsetHalf(png);
  const band = Math.round(w / 20);
  // The edits endpoint repaints where the mask is transparent.
  const mask = Buffer.alloc(w * h * 4, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (crossWeight(x, y, w, h, band * 1.5) < 1) mask[(y * w + x) * 4 + 3] = 0;
  const shifted = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', `Repaint only the band across the middle so the texture continues seamlessly through it, matching its surroundings exactly.\n\n${fullPrompt(a, style)}`);
  form.append('size', a.generate.size);
  form.append('quality', quality);
  form.append('n', '1');
  form.append('image', new Blob([new Uint8Array(shifted)], { type: 'image/png' }), 'image.png');
  form.append('mask', new Blob([new Uint8Array(await sharp(mask, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer())], { type: 'image/png' }), 'mask.png');
  const [fixed] = await images(await fetch(`${API}/edits`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form }));
  // Keep the original pixels away from the cross (their edges already wrap), and blend the
  // repainted band in, so the model can't drift the whole image.
  const rep = await sharp(fixed).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = crossWeight(x, y, w, h, band);
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(rep[i + c] * (1 - k) + data[i + c] * k);
      out[i + 3] = 255;
    }
  }
  const result = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).removeAlpha().png().toBuffer();
  return { png: result, before, after: seamRatio(await readRgb(result)) };
}

const dir = join(RAW, spec.id);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
console.log(`${spec.id}: asking ${model} for ${count} at ${spec.generate.size}...`);
const pngs = await images(
  await fetch(`${API}/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }),
);
for (const [i, png] of pngs.entries()) {
  const cand = `${stamp}-${i + 1}`;
  const meta: Record<string, unknown> = { candidate: cand, prompt, model, size: spec.generate.size, quality, created: new Date().toISOString() };
  writeFileSync(join(dir, `${cand}.orig.png`), png);
  let final = png;
  if (spec.seamless) {
    const s = await makeSeamless(png, spec);
    final = s.png;
    meta.seamless = { method: 'offset by half, inpaint the cross', ratioBefore: +s.before.toFixed(2), ratioAfter: +s.after.toFixed(2) };
    const note = s.after > 1.6 ? ' (still shows a seam; try another)' : '';
    console.log(`  ${cand}: seam ${s.before.toFixed(2)} -> ${s.after.toFixed(2)}${note}`);
  } else console.log(`  ${cand}`);
  writeFileSync(join(dir, `${cand}.png`), final);
  writeFileSync(join(dir, `${cand}.json`), `${JSON.stringify(meta, null, 2)}\n`);
}
console.log(`Pick one: set "source: <candidate>" in prompts/${spec.id}.yaml, then npm run process.`);
