// Screenshots in headless Chrome, for parity and regression checks.
//
//   node tools/shots.ts [baseUrl] [outDir] [--mockup[=url]] [--views] [--clean] [--quality=high|medium|low]
//
// By default it jumps the ghost to six fixed route points. With --views it instead parks the dev
// free camera at fixed viewpoints of the castle (dev server only), which is steadier for judging
// materials and geometry: only the creatures move. With --mockup it also shoots the mockup
// (default docs/mockup/hollowmere-mockup.html on the same server) at the same route points,
// writing <point>-port.png and <point>-mockup.png side by side. --clean hides the HUD, for
// comparing against a reference painting with tools/compare.ts. The quality tier is pinned (high
// unless --quality says otherwise), so a slow moment can't change it mid-run.

import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { launchChrome } from './chrome.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mockupArg = process.argv.find((a) => a.startsWith('--mockup'));
const withMockup = !!mockupArg;
const views = process.argv.includes('--views');
const clean = process.argv.includes('--clean');
const quality = process.argv.find((a) => a.startsWith('--quality='))?.split('=')[1] ?? 'high';
const base = args[0] ?? 'http://localhost:5173';
const mockupUrl = mockupArg?.split('=')[1] ?? `${base}/docs/mockup/hollowmere-mockup.html`;
const out = args[1] ?? 'shots';

/** Route parameter t for six fixed points (waypoint index / 24). */
const POINTS: [string, number][] = [
  ['lake', 0],
  ['glass', 5.4 / 24],
  ['hall', 6.5 / 24],
  ['viaduct', 9.4 / 24],
  ['gate', 11.6 / 24],
  ['keep', 16.2 / 24],
];

type V3 = [number, number, number];

/** Free-camera viewpoints: [name, from, looking at]. */
const VIEWS: [string, V3, V3][] = [
  ['castle', [-215, 30, 215], [0, 70, 0]],
  ['tower', [-84, 74, 46], [-56, 78, 8]],
  ['facade', [-6, 50, 96], [-6, 56, 50]],
  ['interior', [-33, 47, 44], [20, 52, 44]],
  ['viaduct', [82, 36, 92], [110, 28, 37]],
  ['gate', [172, 38, 122], [172, 37, 86]],
  ['roofs', [44, 150, 64], [0, 105, -10]],
];

type Hook = {
  hollowmere?: { jump(t: number): void; dev?: { view(from: V3 | null, to?: V3): void } };
};

async function open(page: Page, url: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => !!(window as Hook).hollowmere, null, { timeout: 30000 });
  if (clean) await page.addStyleTag({ content: '.hud,.placard,#mode,.actions,.altbtns,#loader,.dev-dock,.dev-badge{display:none!important}' });
  await page.waitForTimeout(2500);
  return errors;
}

async function shootPoints(page: Page, url: string, label: string) {
  const errors = await open(page, url);
  for (const [name, t] of POINTS) {
    await page.evaluate((t) => (window as Hook).hollowmere!.jump(t), t);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${out}/${name}-${label}.png` });
  }
  if (errors.length) console.log(`${label} errors:\n  ${errors.join('\n  ')}`);
}

async function shootViews(page: Page, url: string) {
  const errors = await open(page, url);
  const ok = await page.evaluate(() => !!(window as Hook).hollowmere!.dev);
  if (!ok) throw new Error('--views needs the dev server (the free camera is a dev tool)');
  for (const [name, from, to] of VIEWS) {
    await page.evaluate(([f, t]) => (window as Hook).hollowmere!.dev!.view(f, t), [from, to] as const);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  await page.evaluate(() => (window as Hook).hollowmere!.dev!.view(null));
  if (errors.length) console.log(`errors:\n  ${errors.join('\n  ')}`);
}

mkdirSync(out, { recursive: true });
const browser = await launchChrome();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
// A fresh session each time: the dev tools remember the free camera per tab.
const app = `${base}/?quality=${quality}`;
if (views) await shootViews(await context.newPage(), app);
else {
  await shootPoints(await context.newPage(), app, 'port');
  if (withMockup) await shootPoints(await context.newPage(), mockupUrl, 'mockup');
}
await browser.close();
const count = views ? VIEWS.length : POINTS.length * (withMockup ? 2 : 1);
console.log(`wrote ${count} screenshots to ${out}/`);
