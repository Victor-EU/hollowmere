// Render the composed music stems and write public/assets/audio/ plus the manifest's "stems".
//
//   node tools/stems.ts [id ...] [--force] [--report=dir]
//
// Each stem is played from tools/stems/score.ts on the instruments in tools/stems/instruments.ts,
// unless a composer's master is waiting in music/ (music/<id>.wav, or music/<id>-<variant>.wav for
// each variant), which is then used as the loop as it is. Rendering, encoding (Opus and AAC, via
// WebCodecs) and the loop checks happen in headless Chrome. Each stem's loudness is matched to the
// synth layer it replaces. Stems whose sources haven't changed are skipped: Chrome's audio maths
// isn't bit-exact from run to run (about -110 dB apart), so a re-render changes the files' bytes
// though not their sound. --report writes a spectrogram of every loop into the given folder.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createServer } from 'vite';
import type { Manifest, ManifestStem } from '../src/data/manifest.ts';
import { launchChrome } from './chrome.ts';
import { PAD, STEMS, fileName, type Rendered } from './stems/specs.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'public/assets');
const AUDIO = join(OUT, 'audio');
const MANIFEST = join(OUT, 'manifest.json');
const MUSIC = join(ROOT, 'music');

const args = process.argv.slice(2);
const force = args.includes('--force');
const report = args.find((a) => a.startsWith('--report='))?.slice('--report='.length);
const only = args.filter((a) => !a.startsWith('--'));
for (const id of only) if (!STEMS.some((s) => s.id === id)) throw new Error(`no stem "${id}" in tools/stems/specs.ts`);

/** page.ts and everything it imports, transitively, as paths relative to the repo. */
function deps(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) {
      let dep = relative(ROOT, resolve(ROOT, dirname(file), m[1]));
      if (!dep.endsWith('.ts')) dep += '.ts';
      visit(dep);
    }
  };
  visit(entry);
  return [...seen].sort();
}

function masterFor(id: string, variant: string): string | null {
  const name = `${fileName(id, variant)}.wav`;
  return existsSync(join(MUSIC, name)) ? name : null;
}

// The render page and all it imports, and this file (it sets the gain).
const sources = [...deps('tools/stems/page.ts'), 'tools/stems.ts'];
const manifest: Manifest = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest) : { note: '', textures: {} };
manifest.note = 'Written by tools/process.ts (textures) and tools/stems.ts (stems). Do not edit by hand.';
const stems: Record<string, ManifestStem> = (manifest.stems ??= {});
for (const id of Object.keys(stems)) if (!STEMS.some((s) => s.id === id)) delete stems[id];

const todo = STEMS.filter((spec) => !only.length || only.includes(spec.id)).map((spec) => {
  const h = createHash('sha256');
  for (const f of sources) h.update(f).update(readFileSync(join(ROOT, f)));
  h.update(JSON.stringify(spec));
  const masters: Record<string, string> = {};
  for (const v of spec.variants) {
    const m = masterFor(spec.id, v);
    if (m) {
      masters[v] = `/music/${m}`;
      h.update(readFileSync(join(MUSIC, m)));
    }
  }
  const hash = h.digest('hex').slice(0, 16);
  const old = stems[spec.id];
  const filesThere = old?.variants.every((v) => existsSync(join(OUT, v.opus.file)) && existsSync(join(OUT, v.aac.file)));
  return { spec, masters, hash, skip: !force && !report && old?.hash === hash && filesThere };
});

const work = todo.filter((t) => !t.skip);
for (const t of todo) if (t.skip) console.log(`  ${t.spec.id.padEnd(9)} unchanged`);

if (work.length) {
  mkdirSync(AUDIO, { recursive: true });
  if (report) mkdirSync(report, { recursive: true });
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    clearScreen: false,
    server: { port: 0 },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const browser = await launchChrome();
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(`  page: ${e.message}`));
    await page.goto(new URL('tools/stems/index.html', server.resolvedUrls!.local[0]).href);
    await page.waitForFunction(() => !!window.stems, null, { timeout: 30000 });
    for (const { spec, masters, hash } of work) {
      const started = Date.now();
      const r: Rendered = await page.evaluate(([id, m, rep]) => window.stems.render(id, m, rep), [spec.id, masters, !!report] as const);
      const files = r.variants.map((v) => {
        const name = fileName(spec.id, v.variant);
        const write = (ext: string, b64: string) => {
          const bytes = Buffer.from(b64, 'base64');
          writeFileSync(join(AUDIO, `${name}.${ext}`), bytes);
          return { file: `audio/${name}.${ext}`, bytes: bytes.length };
        };
        if (v.spectrogram) writeFileSync(join(report!, `${name}.png`), Buffer.from(v.spectrogram.split(',')[1], 'base64'));
        return { opus: write('ogg', v.opus), aac: write('aac', v.aac) };
      });
      // One gain for the whole stem, so the variants keep the levels they were written at.
      const loud = 10 * Math.log10(r.variants.reduce((s, v) => s + 10 ** (v.loudness / 10), 0) / r.variants.length);
      const gain = 10 ** ((r.reference - loud + spec.trim) / 20);
      stems[spec.id] = {
        layer: spec.layer,
        variants: files,
        loopStart: PAD,
        loopLength: r.loopLength,
        gain: Math.round(gain * 1e4) / 1e4,
        priority: spec.priority,
        source: Object.keys(masters).length ? 'master' : 'score',
        hash,
      };
      writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

      const kb = (n: number) => `${Math.round(n / 1024)} KB`;
      console.log(`  ${spec.id.padEnd(9)} ${r.loopLength} s loop, synth ${r.reference} dB, gain ${gain.toFixed(3)} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      r.variants.forEach((v, i) => {
        const s = v.seam;
        console.log(
          `    ${(v.variant || '-').padEnd(2)} ${v.loudness} dB, peak ${v.peak}, opus ${kb(files[i].opus.bytes)}, aac ${kb(files[i].aac.bytes)}; seam ${s.render} dB rendered, ${s.opus} opus, ${s.aac} aac`,
        );
        if (s.render > -40) console.log(`    ! ${fileName(spec.id, v.variant)} doesn't loop cleanly: its end and its start are ${s.render} dB apart`);
      });
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

// Drop files no stem uses any more.
const used = new Set(Object.values(stems).flatMap((s) => s.variants.flatMap((v) => [v.opus.file, v.aac.file])));
if (existsSync(AUDIO)) for (const f of readdirSync(AUDIO)) if (!used.has(`audio/${f}`)) rmSync(join(AUDIO, f));
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
const total = Object.values(stems).reduce((n, s) => n + s.variants.reduce((m, v) => m + v.opus.bytes, 0), 0);
console.log(`  stems     ${Object.keys(stems).length}, ${(total / 1048576).toFixed(2)} MB as Opus`);
