// Checks the data files and every geometry in a real WebGL context, then flies the route and
// measures draw calls and triangles against the design budgets.
//
//   node tools/validate.ts [devUrl] [--strict]
//
// Without a URL it starts its own Vite dev server (the checks live in the dev build). Exits 1 on
// any error: non-finite or malformed geometry, bad data, or a console error. --strict also fails
// on warnings and budget overruns.

import type { Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { launchChrome } from './chrome.ts';

/** What window.hollowmere.dev.report() returns (src/dev/index.ts). */
interface DevReport {
  problems: { level: 'error' | 'warn'; where: string; what: string }[];
  geometry: { objects: number; geometries: number; attributes: number; vertices: number };
  route: { length: number; duration: number; lowestMargin: number };
  frame: { calls: number; triangles: number };
}

const BUDGET = { calls: 300, triangles: 1_500_000 };
/** Route samples for the budget sweep. */
const STOPS = 24;

type Hook = { hollowmere?: { dev: { report(): DevReport; frame: DevReport['frame'] } | null; jump(t: number): void } };

const strict = process.argv.includes('--strict');
let base = process.argv.slice(2).find((a) => !a.startsWith('--'));
let server: ViteDevServer | null = null;
if (!base) {
  server = await createServer({ server: { port: 0 }, logLevel: 'error', clearScreen: false });
  await server.listen();
  base = server.resolvedUrls!.local[0];
}

const browser = await launchChrome();
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const consoleErrors: string[] = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => {
  // The dev checks log their own findings; those come back in the report.
  if (m.type() === 'error' && !/^(Geometry|Data) check/.test(m.text())) consoleErrors.push(m.text());
});

let report: DevReport;
const sweep: { t: number; calls: number; triangles: number }[] = [];
try {
  await page.goto(base);
  await page.waitForFunction(() => !!(window as Hook).hollowmere?.dev, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < STOPS; i++) {
    const t = i / STOPS;
    await page.evaluate((t) => (window as Hook).hollowmere!.jump(t), t);
    await page.waitForTimeout(500);
    const f = await page.evaluate(() => (window as Hook).hollowmere!.dev!.frame);
    sweep.push({ t, calls: f.calls, triangles: f.triangles });
  }
  report = await page.evaluate(() => (window as Hook).hollowmere!.dev!.report());
} finally {
  await browser.close();
  await server?.close();
}

const errors = report.problems.filter((p) => p.level === 'error');
const warnings = report.problems.filter((p) => p.level === 'warn');
const worst = (k: 'calls' | 'triangles') => sweep.reduce((a, b) => (b[k] > a[k] ? b : a));
const overCalls = sweep.filter((s) => s.calls > BUDGET.calls);
const overTris = sweep.filter((s) => s.triangles > BUDGET.triangles);
const { geometry: g, route: r } = report;
const mark = (ok: boolean) => (ok ? '✓' : '✗');
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`);

console.log(`Hollowmere validate · ${base}`);
console.log(`  geometry  ${g.objects} objects, ${g.geometries} geometries, ${fmt(g.vertices)} vertices`);
console.log(`  route     ${(r.length / 1000).toFixed(2)} km, ${Math.floor(r.duration / 60)} min ${Math.round(r.duration % 60)} s a loop, lowest ${r.lowestMargin.toFixed(1)} m above clearance`);
console.log(`  draws     ${mark(!overCalls.length)} worst ${worst('calls').calls} at t=${worst('calls').t.toFixed(3)} (budget ${BUDGET.calls}; over at ${overCalls.length} of ${STOPS} points)`);
console.log(`  triangles ${mark(!overTris.length)} worst ${fmt(worst('triangles').triangles)} at t=${worst('triangles').t.toFixed(3)} (budget 1.5M)`);
console.log(`  console   ${mark(!consoleErrors.length)} ${consoleErrors.length} errors`);
for (const p of errors) console.log(`  ✗ ${p.where}: ${p.what}`);
for (const e of consoleErrors) console.log(`  ✗ console: ${e}`);
for (const p of warnings) console.log(`  ! ${p.where}: ${p.what}`);

const failed = errors.length + consoleErrors.length + (strict ? warnings.length + overCalls.length + overTris.length : 0);
console.log(failed ? `\n${failed} problem(s)${strict ? ' (strict)' : ''}` : `\nAll checks passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}.`);
process.exit(failed ? 1 : 0);
