// Screenshots of fixed route points in headless Chrome, for parity and regression checks.
//
//   node tools/shots.ts [baseUrl] [outDir] [--mockup[=url]]
//
// With --mockup it also shoots the mockup (default docs/mockup/hollowmere-mockup.html on the
// same server) at the same points, writing <point>-port.png and <point>-mockup.png side by side.

import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { launchChrome } from './chrome.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const mockupArg = process.argv.find((a) => a.startsWith('--mockup'));
const withMockup = !!mockupArg;
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

type Hook = { hollowmere?: { jump(t: number): void } };

async function shoot(page: Page, url: string, label: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => !!(window as Hook).hollowmere, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  for (const [name, t] of POINTS) {
    await page.evaluate((t) => (window as Hook).hollowmere!.jump(t), t);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${out}/${name}-${label}.png` });
  }
  if (errors.length) console.log(`${label} errors:\n  ${errors.join('\n  ')}`);
}

mkdirSync(out, { recursive: true });
const browser = await launchChrome();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await shoot(await context.newPage(), `${base}/`, 'port');
if (withMockup) await shoot(await context.newPage(), mockupUrl, 'mockup');
await browser.close();
console.log(`wrote ${POINTS.length * (withMockup ? 2 : 1)} screenshots to ${out}/`);
