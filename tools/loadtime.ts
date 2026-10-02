// Measures how long a cold visit takes to become interactive: the first frame drawn, with the
// controls live (design doc §12: under 3 s, with 5 MB or less fetched by then).
//
//   node tools/loadtime.ts [previewUrl] [--profile=desktop|phone] [--runs=3]
//
// Without a URL it builds the site into a temporary folder and serves that the way a static host
// would (gzip for text and WebAssembly, over HTTP/1.1, which is the slower case), since the dev
// server's unbundled modules say nothing about a real visit. Every run is a fresh browser context
// (an empty cache) behind a throttled network, and the phone profile also slows the CPU 4x.
// Headless Chrome draws with the real GPU, so the shader compile and the first frame are what this
// machine's would be. The fonts come from Google over the real network, throttled the same way.

import { launchChrome } from './chrome.ts';
import { buildAndServe, type Site } from './static.ts';

interface Profile {
  /** Download and upload in bytes per second, round trip in ms. */
  down: number;
  up: number;
  rtt: number;
  cpu: number;
  viewport: { width: number; height: number };
  scale: number;
  touch: boolean;
}

const mbps = (n: number) => (n * 1e6) / 8;
const PROFILES: Record<string, Profile> = {
  // Home broadband on a mid-range laptop.
  desktop: { down: mbps(30), up: mbps(10), rtt: 40, cpu: 1, viewport: { width: 1280, height: 720 }, scale: 1, touch: false },
  // Good 4G on a three-year-old phone.
  phone: { down: mbps(12), up: mbps(4), rtt: 70, cpu: 4, viewport: { width: 390, height: 844 }, scale: 3, touch: true },
};
const BUDGET = { seconds: 3, bytes: 5 * 1024 * 1024 };

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const profiles = (opt('profile') ?? 'desktop,phone').split(',');
for (const p of profiles) if (!PROFILES[p]) throw new Error(`no profile "${p}"; there are ${Object.keys(PROFILES).join(', ')}`);
const runs = Number(opt('runs') ?? 3);
let base = args.find((a) => !a.startsWith('--'));

let site: Site | null = null;
if (!base) {
  site = await buildAndServe();
  base = site.url;
}

interface Run {
  marks: Record<string, number>;
  interactive: number;
  bytesThen: number;
  requestsThen: number;
  bytesAfter: number;
  slowest: { url: string; bytes: number; end: number }[];
}

const browser = await launchChrome();
const results: Record<string, Run[]> = {};
try {
  for (const name of profiles) {
    const P = PROFILES[name];
    results[name] = [];
    for (let r = 0; r < runs; r++) {
      const context = await browser.newContext({ viewport: P.viewport, deviceScaleFactor: P.scale, hasTouch: P.touch, isMobile: P.touch });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: P.rtt, downloadThroughput: P.down, uploadThroughput: P.up });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base, { waitUntil: 'commit' });
      await page.waitForFunction(() => performance.getEntriesByName('hm:first-frame').length > 0, null, { timeout: 60000, polling: 50 });
      const at = await page.evaluate(() => {
        const marks: Record<string, number> = {};
        for (const m of performance.getEntriesByType('mark')) if (m.name.startsWith('hm:')) marks[m.name.slice(3)] = m.startTime;
        const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return { marks, res: res.map((e) => ({ url: e.name, bytes: e.transferSize || e.encodedBodySize, end: e.responseEnd })), nav: nav.transferSize || nav.encodedBodySize };
      });
      // Let the background loading finish, then count everything fetched.
      await page.waitForTimeout(4000);
      const later = await page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).reduce((n, e) => n + (e.transferSize || e.encodedBodySize), 0));
      const t = at.marks['first-frame'];
      const before = at.res.filter((e) => e.end <= t);
      results[name].push({
        marks: at.marks,
        interactive: t,
        bytesThen: at.nav + before.reduce((n, e) => n + e.bytes, 0),
        requestsThen: before.length + 1,
        bytesAfter: at.nav + later,
        slowest: [...before].sort((a, b) => b.end - a.end).slice(0, 4),
      });
      if (errors.length) console.log(`  ! ${name} run ${r + 1}: ${errors.join('; ')}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  site?.close();
}

const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
let failed = 0;
console.log(`Hollowmere load time · ${base}`);
for (const [name, rs] of Object.entries(results)) {
  const P = PROFILES[name];
  const mid = rs.find((r) => r.interactive === median(rs.map((x) => x.interactive)))!;
  const ok = mid.interactive <= BUDGET.seconds * 1000 && mid.bytesThen <= BUDGET.bytes;
  if (!ok) failed++;
  console.log(
    `  ${name.padEnd(8)} ${ok ? '✓' : '✗'} interactive in ${s(mid.interactive)} (median of ${rs.length}: ${rs.map((r) => s(r.interactive)).join(', ')}) · ${mb(mid.bytesThen)} in ${mid.requestsThen} requests by then, ${mb(mid.bytesAfter)} after 4 s · ${(P.down * 8) / 1e6} Mbps, ${P.rtt} ms, CPU ${P.cpu}x`,
  );
  const order = Object.entries(mid.marks).sort((a, b) => a[1] - b[1]);
  console.log(`           ${order.map(([k, v]) => `${k} ${s(v)}`).join(' → ')}`);
  for (const e of mid.slowest) console.log(`           last in: ${e.url.replace(base, '')} ${Math.round(e.bytes / 1024)} KB at ${s(e.end)}`);
}
console.log(failed ? `\n${failed} profile(s) over budget (${BUDGET.seconds} s, ${mb(BUDGET.bytes)})` : `\nWithin budget (${BUDGET.seconds} s, ${mb(BUDGET.bytes)}).`);
process.exit(failed ? 1 : 0);
