// Checks the accessibility rules of design doc §14 against the production build, in headless Chrome:
//
//   node tools/a11y.ts [url] [--skip=axe,keys,status,motion,contrast,flash] [--seconds=20]
//
//   axe       axe-core's WCAG 2.2 A and AA rules and best practices: on the page as it loads, with the
//             controls list open, on a phone, and with WebGL unavailable
//   keys      Tab reaches every control, each with a visible focus ring; H, Esc, F, M and Space on a
//             button do what they say; the touch ▲ ▼ buttons can be held from the keyboard too
//   status    the live region speaks the status pill's changes, but not its per-second countdown; and
//             the title placard fades once the controls have been touched
//   motion    prefers-reduced-motion reaches the app, and the mist stops drifting
//   contrast  the HUD's text against what is really drawn behind it (axe can't see into the canvas),
//             at twelve points round the route, on a desktop and a phone: 4.5:1, or 3:1 for large text
//   flash     flashes counted from the frames themselves, as WCAG 2.3.1 defines them, for --seconds at
//             each named route point: fails if more than three a second (general or red), flashing
//             together, cover a quarter of any 10° field of view (341 × 256 px at 1024 × 768). Luminance is
//             averaged over 16 px cells first, which a flash that size spans dozens of, and which
//             evens out the film grain (noise from pixel to pixel, not a flash). A 5 Hz strobe runs
//             first as a control, and has to fail
//
// Without a URL it builds and serves the site itself (tools/static.ts). The tier is pinned to high,
// the look the HUD was designed over. Exits 1 on any failure.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BrowserContextOptions, Page } from 'playwright-core';
import sharp from 'sharp';
import { launchChrome } from './chrome.ts';
import { buildAndServe, type Site } from './static.ts';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const skip = new Set((opt('skip') ?? '').split(',').filter(Boolean));
const seconds = Number(opt('seconds') ?? 20);
let base = args.find((a) => !a.startsWith('--'));

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
/** Route positions (0–1 round the loop) for the contrast views. */
const STOPS = 12;
/** Route points (data/route.json `named`) the flash count watches from. */
const FLASH_AT = ['lake', 'hall', 'gate', 'keep'];

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
const PHONE: BrowserContextOptions = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
/** Makes WebGL unavailable, as on a browser with it turned off. */
const NO_WEBGL = `{
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : get.call(this, type, ...rest); };
}`;

type Hook = {
  hollowmere: {
    flight: { time: number; vel: { y: number } };
    scene: { traverse(fn: (o: { material?: { uniforms?: Record<string, { value: unknown }> } }) => void): void };
    renderer: { getContext(): WebGL2RenderingContext; setRenderTarget(t: null): void };
    audio: { trigger(type: string, ...rest: unknown[]): void };
    reduceMotion: boolean;
    jump(t: number): void;
  };
};

interface Result {
  name: string;
  ok: boolean;
  summary: string;
  details: string[];
}
const results: Result[] = [];
const report = (name: string, problems: string[], summary: string, notes: string[] = []) =>
  results.push({ name, ok: !problems.length, summary, details: [...problems.map((p) => `✗ ${p}`), ...notes.map((n) => `· ${n}`)] });

let site: Site | null = null;
if (!base) {
  site = await buildAndServe();
  base = site.url;
}
const browser = await launchChrome();
const pageErrors: string[] = [];

async function open(options: BrowserContextOptions, query = '', init?: string): Promise<Page> {
  const context = await browser.newContext(options);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(new URL(`?quality=high${query}`, base).href);
  // The loader hides itself after the first frame, or at once when WebGL is missing.
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#loader')?.hidden === true, null, { timeout: 60000 });
  return page;
}
const close = (page: Page) => page.context().close();

// ── axe ─────────────────────────────────────────────────────────────────────────────────────────────

async function axe(page: Page, state: string) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: AXE });
  const found = await page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run(ctx: Document, o: object): Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, where: v.nodes.map((n) => n.target.join(' ')).slice(0, 3) }));
  }, AXE_TAGS);
  return found.map((v) => `${state}: ${v.id} (${v.impact}) ${v.help}: ${v.where.join(', ')}`);
}

async function checkAxe() {
  const problems: string[] = [];
  let page = await open(DESKTOP);
  problems.push(...(await axe(page, 'desktop')));
  await page.keyboard.press('KeyH');
  problems.push(...(await axe(page, 'controls open')));
  await close(page);
  page = await open(PHONE);
  await page.tap('#btnHelp');
  problems.push(...(await axe(page, 'phone, controls open')));
  await close(page);
  page = await open(DESKTOP, '', NO_WEBGL);
  if (!(await page.isVisible('#nogl'))) problems.push('no WebGL: the fallback message is not shown');
  problems.push(...(await axe(page, 'no WebGL')));
  await close(page);
  report('axe', problems, problems.length ? `${problems.length} violation(s)` : 'no violations: desktop, controls open, phone, no WebGL');
}

// ── keys ────────────────────────────────────────────────────────────────────────────────────────────

/** Names the focused element and says whether it shows a focus ring. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const name = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 24)}"`;
    return { name, ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 };
  });

/** Every control a keyboard user should reach right now. */
const reachable = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.checkVisibility())
      .map((el) => (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 24)}"`)),
  );

async function tabRound(page: Page) {
  const seen: { name: string; ring: boolean }[] = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (!f || seen.some((s) => s.name === f.name)) break;
    seen.push(f);
  }
  return seen;
}

async function checkKeys() {
  const problems: string[] = [];
  const page = await open(DESKTOP);
  const attr = (sel: string, a: string) => page.getAttribute(sel, a);
  const missed = async (seen: { name: string }[], state: string) => {
    for (const r of await reachable(page)) if (!seen.some((s) => s.name === r)) problems.push(`${state}: Tab never reaches ${r}`);
  };
  const round = await tabRound(page);
  await missed(round, 'controls closed');
  for (const f of round) if (!f.ring) problems.push(`${f.name} shows no focus ring`);

  await page.keyboard.press('KeyH');
  if (!(await page.isVisible('#help')) || (await attr('#btnHelp', 'aria-expanded')) !== 'true') problems.push('H does not open the controls list');
  const open2 = await tabRound(page);
  await missed(open2, 'controls open');
  for (const f of open2) if (!f.ring && !round.some((r) => r.name === f.name)) problems.push(`${f.name} shows no focus ring`);
  await page.keyboard.press('Escape');
  if (await page.isVisible('#help')) problems.push('Esc does not close the controls list');

  await page.focus('#scene');
  await page.keyboard.press('KeyF');
  const autoOff = await attr('#btnAuto', 'aria-pressed');
  await page.keyboard.press('KeyF');
  if (autoOff !== 'false' || (await attr('#btnAuto', 'aria-pressed')) !== 'true') problems.push('F does not toggle autofly');
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => document.querySelector('#btnSound')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).catch(() => problems.push('M does not turn sound on'));
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => document.querySelector('#btnSound')?.getAttribute('aria-pressed') === 'false', null, { timeout: 5000 }).catch(() => problems.push('M does not turn sound off'));
  // Space on a focused button presses it once, and isn't also taken as "rise".
  await page.focus('#btnAuto');
  await page.keyboard.press('Space');
  if ((await attr('#btnAuto', 'aria-pressed')) !== 'false') problems.push('Space on the Autofly button does not press it (or presses it twice)');
  await page.keyboard.press('Space');
  await close(page);

  // The touch screen's rise and sink buttons, held from a keyboard (a phone with one, or switch access).
  const phone = await open(PHONE);
  const held = async (sel: string) => {
    await phone.focus(sel);
    await phone.keyboard.down('Space');
    await phone.waitForTimeout(900);
    const vy = await phone.evaluate(() => (window as unknown as Hook).hollowmere.flight.vel.y);
    await phone.keyboard.up('Space');
    await phone.waitForTimeout(600);
    return vy;
  };
  const up = await held('#btnUp');
  const down = await held('#btnDown');
  if (!(up > 0.5)) problems.push(`holding Space on ▲ doesn't rise (vertical speed ${up.toFixed(2)} m/s)`);
  if (!(down < -0.5)) problems.push(`holding Space on ▼ doesn't sink (vertical speed ${down.toFixed(2)} m/s)`);
  await close(phone);
  report('keys', problems, `Tab: ${round.map((f) => f.name).join(' → ')}, then the list's links; H, Esc, F, M, Space; ▲ ▼ held from the keyboard`);
}

// ── status ──────────────────────────────────────────────────────────────────────────────────────────

async function checkStatus() {
  const problems: string[] = [];
  const page = await open(DESKTOP);
  await page.evaluate(() => {
    const w = window as unknown as { said: string[]; shown: string[] };
    const log: string[] = (w.said = []);
    const shown: string[] = (w.shown = []);
    const announce = document.querySelector('#announce')!;
    new MutationObserver(() => log.push(announce.textContent ?? '')).observe(announce, { childList: true, characterData: true, subtree: true });
    const sub = document.querySelector('#modeSub')!;
    new MutationObserver(() => shown.push(sub.textContent ?? '')).observe(sub, { childList: true, characterData: true, subtree: true });
  });
  await page.waitForTimeout(2500);
  // Take over for two seconds, then let go and wait out the countdown.
  await page.focus('#scene');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(15000);
  const { said, shown, live, faded } = await page.evaluate(() => ({
    ...(window as unknown as { said: string[]; shown: string[] }),
    live: document.querySelector('#mode')?.getAttribute('aria-live') ?? null,
    faded: getComputedStyle(document.querySelector('#placard')!).opacity === '0',
  }));
  await close(page);
  if (!shown.some((s) => /returns in \d/.test(s))) problems.push('the countdown never showed, so this check proved nothing');
  if (said.some((s) => /\d+ s\b/.test(s))) problems.push(`the countdown was spoken: ${said.join(' | ')}`);
  if (!said.some((s) => s.startsWith('Free flight'))) problems.push('taking over was not announced');
  if (!said.slice(said.findIndex((s) => s.startsWith('Free flight'))).some((s) => s.startsWith('Autofly'))) problems.push("autofly's return was not announced");
  if (said.length > 8) problems.push(`${said.length} announcements in 20 s is chatty`);
  if (live) problems.push('the status pill is itself a live region, so its countdown is spoken too');
  if (!faded) problems.push("the title placard hasn't faded after the controls were touched (design doc §14)");
  report('status', problems, `${said.length} announcements in 20 s (${said.map((s) => `"${s}"`).join(', ')}); the pill changed ${shown.length} times; the placard faded`);
}

// ── motion ──────────────────────────────────────────────────────────────────────────────────────────

async function checkMotion() {
  const problems: string[] = [];
  const read = async (reducedMotion: 'reduce' | 'no-preference') => {
    const page = await open({ ...DESKTOP, reducedMotion });
    const r = await page.evaluate(() => {
      const h = (window as unknown as Hook).hollowmere;
      let spin: unknown = null;
      h.scene.traverse((o) => {
        if (o.material?.uniforms?.uSpin) spin = o.material.uniforms.uSpin.value;
      });
      return { app: h.reduceMotion, spin };
    });
    await close(page);
    return r;
  };
  const calm = await read('reduce');
  const full = await read('no-preference');
  if (!calm.app) problems.push('the app ignores prefers-reduced-motion: reduce');
  if (calm.spin !== 0) problems.push(`the mist still drifts with reduced motion (uSpin ${String(calm.spin)})`);
  if (full.app || full.spin !== 1) problems.push('reduced motion is on without being asked for');
  report('motion', problems, 'reduce: no bob, grain or mist drift, a softer phase effect, gentler autofly turns (read by the app; mist checked)');
}

// ── contrast ────────────────────────────────────────────────────────────────────────────────────────

interface TextRun {
  name: string;
  rgba: [number, number, number, number];
  large: boolean;
  rects: { x: number; y: number; w: number; h: number }[];
}

/** Every visible run of HUD text, with its colour, its size class and the boxes its glyphs sit in. */
const textRuns = (page: Page) =>
  page.evaluate(() => {
    const runs: TextRun[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim() || el.closest('.sr-only, #loader, #nogl, noscript, script, style') || !el.checkVisibility({ opacityProperty: true })) continue;
      const s = getComputedStyle(el);
      const rgba = (s.color.match(/[\d.]+/g) ?? []).map(Number);
      const range = document.createRange();
      range.selectNodeContents(n);
      const size = parseFloat(s.fontSize);
      const bold = Number(s.fontWeight) >= 700;
      runs.push({
        name: `${el.closest('[id]')?.id ?? ''} ${el.tagName.toLowerCase()} "${n.textContent.trim().slice(0, 28)}"`,
        rgba: [rgba[0], rgba[1], rgba[2], rgba[3] ?? 1],
        large: size >= 24 || (bold && size >= 18.66),
        rects: [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
      });
    }
    return runs;
  });

const toLinear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (r: number, g: number, b: number) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The HUD text hidden but everything else (glass, blur, borders) left, as a picture of what's behind it. */
const HIDE_TEXT = '*{color:transparent !important;text-shadow:none !important;text-decoration-color:transparent !important}';

async function contrastAt(page: Page, scale: number, where: string, worst: Map<string, { c: number; where: string; need: number }>) {
  const runs = await textRuns(page);
  const style = await page.addStyleTag({ content: HIDE_TEXT });
  const shot = await page.screenshot({ type: 'png' });
  await style.evaluate((s) => (s as Element).remove());
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  for (const run of runs) {
    const [tr, tg, tb, ta] = run.rgba;
    const scores: number[] = [];
    for (const r of run.rects) {
      const x0 = Math.max(0, Math.floor(r.x * scale)), y0 = Math.max(0, Math.floor(r.y * scale));
      const x1 = Math.min(info.width, Math.ceil((r.x + r.w) * scale)), y1 = Math.min(info.height, Math.ceil((r.y + r.h) * scale));
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * info.width + x) * info.channels;
          const [br, bg, bb] = [data[i], data[i + 1], data[i + 2]];
          // Translucent text lands on its background.
          const fg = luminance(tr * ta + br * (1 - ta), tg * ta + bg * (1 - ta), tb * ta + bb * (1 - ta));
          scores.push(ratio(fg, luminance(br, bg, bb)));
        }
    }
    if (!scores.length) continue;
    // The worst few percent of the background, so a single star doesn't decide it.
    scores.sort((a, b) => a - b);
    const c = scores[Math.floor(scores.length * 0.05)];
    const prev = worst.get(run.name);
    if (!prev || c < prev.c) worst.set(run.name, { c, where, need: run.large ? 3 : 4.5 });
  }
}

async function checkContrast() {
  const problems: string[] = [];
  const notes: string[] = [];
  let views = 0;
  let lowest = { c: Infinity, name: '', where: '' };
  for (const [label, options] of [
    ['desktop', DESKTOP],
    ['phone', PHONE],
  ] as const) {
    const page = await open(options);
    const worst = new Map<string, { c: number; where: string; need: number }>();
    for (let i = 0; i < STOPS; i++) {
      const t = i / STOPS;
      await page.evaluate((t) => (window as unknown as Hook).hollowmere.jump(t), t);
      await page.waitForTimeout(1200);
      // The controls list, open over a third of the views.
      const help = i % 3 === 1;
      if (help) await page.click('#btnHelp');
      await contrastAt(page, options.deviceScaleFactor ?? 1, `t=${t.toFixed(2)}`, worst);
      if (help) await page.click('#btnHelp');
      views++;
    }
    await close(page);
    for (const [name, w] of worst) {
      if (w.c < w.need) problems.push(`${label}: ${name} drops to ${w.c.toFixed(2)}:1 at ${w.where} (needs ${w.need}:1)`);
      if (w.c < lowest.c) lowest = { c: w.c, name: `${label}: ${name}`, where: w.where };
    }
    const sorted = [...worst].sort((a, b) => a[1].c - b[1].c).slice(0, 3);
    notes.push(`${label} lowest: ${sorted.map(([n, w]) => `${n} ${w.c.toFixed(1)}:1`).join(', ')}`);
  }
  report('contrast', problems, `lowest ${lowest.c.toFixed(2)}:1 (${lowest.name} at ${lowest.where}) over ${views} views`, notes);
}

// ── flash ───────────────────────────────────────────────────────────────────────────────────────────

interface FlashStats {
  /** The most flashes (pairs of opposing transitions) any 10° field made within one second. */
  most: number;
  /** The largest share of a 10° field seen changing the same way at once (and mostly that way). */
  together: number;
  /** Where the most flashes were: seconds in, and the field's centre as a fraction of the screen. */
  worst: { t: number; x: number; y: number } | null;
}

interface FlashReport {
  frames: number;
  fps: number;
  general: FlashStats;
  red: FlashStats;
  fires: number;
}

/**
 * Runs in the page: reads back every frame and finds, per 16 × 16 px cell, each transition (a swing
 * of luminance, or of red, past the WCAG threshold). A 10° field makes a transition when a quarter of
 * it has swung the same way together, within a sixth of a second (half a 3 Hz period), and at least
 * twice as much of it that way as the other; a flash is a pair of opposing ones. Cells that swing out
 * of step, like candles streaming past or stained glass sliding by a moving camera, don't add up to a
 * flash, which is also how WCAG counts: flashes "occurring concurrently".
 */
function measureFlashes(seconds: number): Promise<FlashReport> {
  const h = (window as unknown as Hook).hollowmere;
  let fires = 0;
  const trigger = h.audio.trigger.bind(h.audio);
  h.audio.trigger = (type: string, ...rest: unknown[]) => {
    if (type === 'roar') fires++;
    trigger(type, ...rest);
  };
  const gl = h.renderer.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const GW = Math.round(W / 16);
  const GH = Math.round((GW * H) / W);
  const N = GW * GH;
  const pixels = new Uint8Array(W * H * 4);
  const lin = new Float32Array(256).map((_, i) => (i / 255 <= 0.04045 ? i / 255 / 12.92 : ((i / 255 + 0.055) / 1.055) ** 2.4));
  const colX = new Int32Array(W).map((_, x) => Math.min(GW - 1, Math.floor((x * GW) / W)));
  const sums = new Float32Array(N * 3);
  const counts = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) counts[Math.min(GH - 1, Math.floor((y * GH) / H)) * GW + colX[x]]++;
  // A 10° field: a third of the width and height of a 1024 × 768 screen, in cells; one at every cell.
  const FW = Math.round((GW * 341) / 1024);
  const FH = Math.round((GH * 256) / 768);
  const WX = GW - FW + 1;
  const NW = WX * (GH - FH + 1);
  const TOGETHER = 1 / 6;
  const SHARE = 0.25;
  const KEEP = 16;

  /**
   * One kind of flash. A cell's transition is a swing of at least `delta` from its last turning
   * point, which `counts` must accept: for general flashes, the darker side under 0.8; for red ones,
   * either side a saturated red.
   */
  const tracker = (delta: number, counts: (from: number, to: number) => boolean) => {
    const anchor = new Float32Array(N);
    /** The tag (see `step`) at the turning point. */
    const anchorTag = new Float32Array(N);
    const lo = new Float32Array(N);
    const hi = new Float32Array(N);
    const dir = new Int8Array(N);
    /** When each cell last made a transition, and which way. */
    const when = new Float32Array(N).fill(-1e9);
    const way = new Int8Array(N);
    const up = new Float32Array((GW + 1) * (GH + 1));
    const down = new Float32Array((GW + 1) * (GH + 1));
    /** Per field: which way it last moved together, and when (a ring of the last few). */
    const fieldWay = new Int8Array(NW);
    const fieldWhen = new Float32Array(NW * KEEP).fill(-1e9);
    const fieldNext = new Uint8Array(NW);
    const stats: FlashStats = { most: 0, together: 0, worst: null };
    let started = false;
    return {
      stats,
      /** `values` are what swings; `tags` are what `counts` judges each side by. */
      step(values: Float32Array, tags: Float32Array, now: number, counting: boolean) {
        for (let i = 0; i < N; i++) {
          const v = values[i];
          if (!started) {
            anchor[i] = lo[i] = hi[i] = v;
            anchorTag[i] = tags[i];
            continue;
          }
          let turned = 0;
          if (dir[i] === 0) {
            if (v < lo[i]) [lo[i], anchorTag[i]] = [v, tags[i]];
            if (v > hi[i]) hi[i] = v;
            if (v - lo[i] >= delta && counts(anchorTag[i], tags[i])) turned = 1;
            else if (hi[i] - v >= delta && counts(tags[i], tags[i])) turned = -1;
          } else if (dir[i] === 1) {
            if (v > anchor[i]) [anchor[i], anchorTag[i]] = [v, tags[i]];
            else if (anchor[i] - v >= delta && counts(anchorTag[i], tags[i])) turned = -1;
          } else {
            if (v < anchor[i]) [anchor[i], anchorTag[i]] = [v, tags[i]];
            else if (v - anchor[i] >= delta && counts(anchorTag[i], tags[i])) turned = 1;
          }
          if (turned) {
            dir[i] = turned;
            anchor[i] = v;
            anchorTag[i] = tags[i];
            if (counting) {
              when[i] = now;
              way[i] = turned;
            }
          }
        }
        started = true;
        if (!counting) return;
        // Summed-area tables of the cells that swung up, and down, just now.
        for (let y = 0; y < GH; y++) {
          let rowUp = 0;
          let rowDown = 0;
          for (let x = 0; x < GW; x++) {
            const i = y * GW + x;
            const recent = now - when[i] <= TOGETHER;
            rowUp += recent && way[i] === 1 ? 1 : 0;
            rowDown += recent && way[i] === -1 ? 1 : 0;
            const a = (y + 1) * (GW + 1) + x + 1;
            up[a] = up[a - GW - 1] + rowUp;
            down[a] = down[a - GW - 1] + rowDown;
          }
        }
        const area = (t: Float32Array, x: number, y: number) =>
          (t[(y + FH) * (GW + 1) + x + FW] - t[y * (GW + 1) + x + FW] - t[(y + FH) * (GW + 1) + x] + t[y * (GW + 1) + x]) / (FW * FH);
        for (let w = 0; w < NW; w++) {
          const x = w % WX;
          const y = (w - x) / WX;
          const rising = area(up, x, y);
          const falling = area(down, x, y);
          // The field as a whole has to go one way: texture or bars sliding past a moving camera
          // brighten as many cells as they darken, and that's motion, not a flash.
          const d = rising >= 2 * falling ? 1 : falling >= 2 * rising ? -1 : 0;
          const share = d === 1 ? rising : d === -1 ? falling : 0;
          if (share > stats.together) stats.together = share;
          if (share < SHARE || fieldWay[w] === d) continue;
          fieldWay[w] = d;
          fieldWhen[w * KEEP + fieldNext[w]] = now;
          fieldNext[w] = (fieldNext[w] + 1) % KEEP;
          let recent = 0;
          for (let k = 0; k < KEEP; k++) if (now - fieldWhen[w * KEEP + k] <= 1) recent++;
          if (recent / 2 > stats.most) {
            stats.most = recent / 2;
            // readPixels rows run bottom up.
            stats.worst = { t: now, x: (x + FW / 2) / GW, y: 1 - (y + FH / 2) / GH };
          }
        }
      },
    };
  };
  // General: a change of 0.1 in relative luminance, with the darker side below 0.8 (tags are luminance).
  const general = tracker(0.1, (from, to) => Math.min(from, to) < 0.8);
  // Red: a change of 20 in (R − G − B) × 320, with either side a saturated red (tags are 1 or 0).
  // Gating the count rather than the value keeps a colour hovering at the 0.8 line from flickering.
  const red = tracker(20, (from, to) => from > 0 || to > 0);
  const lum = new Float32Array(N);
  const redness = new Float32Array(N);
  const saturated = new Float32Array(N);

  return new Promise((done) => {
    const t0 = h.flight.time;
    const wall = performance.now();
    let frames = 0;
    let drawn = -1;
    const sample = () => {
      // A frame the app skipped (the unfocused 30 fps cap) has nothing in the drawing buffer.
      if (h.flight.time === drawn) {
        requestAnimationFrame(sample);
        return;
      }
      drawn = h.flight.time;
      // Runs after the app's own frame callback, so the drawing buffer holds the frame just drawn.
      h.renderer.setRenderTarget(null);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      sums.fill(0);
      for (let y = 0; y < H; y++) {
        const rowCell = Math.min(GH - 1, Math.floor((y * GH) / H)) * GW;
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4;
          const c = (rowCell + colX[x]) * 3;
          sums[c] += lin[pixels[p]];
          sums[c + 1] += lin[pixels[p + 1]];
          sums[c + 2] += lin[pixels[p + 2]];
        }
      }
      for (let i = 0; i < N; i++) {
        const r = sums[i * 3] / counts[i], g = sums[i * 3 + 1] / counts[i], b = sums[i * 3 + 2] / counts[i];
        lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // WCAG's red: (R − G − B) × 320, where R / (R + G + B) ≥ 0.8 makes it saturated.
        redness[i] = Math.max(0, (r - g - b) * 320);
        saturated[i] = r + g + b > 0 && r / (r + g + b) >= 0.8 ? 1 : 0;
      }
      const now = h.flight.time - t0;
      // The first second only settles each cell's starting point.
      general.step(lum, lum, now, now > 1);
      red.step(redness, saturated, now, now > 1);
      frames++;
      if (now < seconds + 1) requestAnimationFrame(sample);
      else done({ frames, fps: frames / ((performance.now() - wall) / 1000), general: general.stats, red: red.stats, fires });
    };
    requestAnimationFrame(sample);
  });
}

async function checkFlash() {
  const problems: string[] = [];
  const notes: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  let most = 0;
  const view: BrowserContextOptions = { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 };
  // A control first: a 5 Hz strobe of the exposure, which the count has to catch or it proves nothing.
  const control = await open(view, '&at=lake');
  await control.evaluate(() => {
    const h = (window as unknown as { hollowmere: { look: { grade: { exposure: number } }; lookChanged(): void } }).hollowmere;
    const normal = h.look.grade.exposure;
    let bright = false;
    setInterval(() => {
      bright = !bright;
      h.look.grade.exposure = bright ? normal * 5 : normal;
      h.lookChanged();
    }, 100);
  });
  const c = await control.evaluate(measureFlashes, 5);
  await close(control);
  if (!(c.general.most > 3)) problems.push(`the control, a 5 Hz strobe, counted only ${c.general.most} flashes a second, so the count can't be trusted`);
  notes.push(`control: a 5 Hz strobe of the whole screen counts ${c.general.most} flashes a second`);
  for (const at of FLASH_AT) {
    const page = await open(view, `&at=${at}`);
    const r = await page.evaluate(measureFlashes, seconds);
    await close(page);
    most = Math.max(most, r.general.most, r.red.most);
    if (r.general.most > 3) problems.push(`${at}: ${r.general.most} flashes within a second over a quarter of a 10° field`);
    if (r.red.most > 3) problems.push(`${at}: ${r.red.most} red flashes within a second over a quarter of a 10° field`);
    if (r.fps < 20) problems.push(`${at}: only ${r.fps.toFixed(0)} frames a second read back, too few to see a 3 Hz flicker`);
    const where = (w: FlashStats['worst']) => (w ? ` (${w.t.toFixed(1)} s in, centred ${pct(w.x)} across and ${pct(w.y)} down)` : '');
    notes.push(
      `${at}: ${r.frames} frames (${r.fps.toFixed(0)} fps), the wyrm breathed fire ${r.fires}×; most flashes in a second ${r.general.most}${where(r.general.worst)}, red ${r.red.most}${where(r.red.worst)}; most of a field swinging together ${pct(r.general.together)}, red ${pct(r.red.together)}`,
    );
  }
  report('flash', problems, `at most ${most} flashes a second over a quarter of any 10° field (limit 3), ${seconds} s at each of ${FLASH_AT.join(', ')}`, notes);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────

const CHECKS: [string, () => Promise<void>][] = [
  ['axe', checkAxe],
  ['keys', checkKeys],
  ['status', checkStatus],
  ['motion', checkMotion],
  ['contrast', checkContrast],
  ['flash', checkFlash],
];
try {
  for (const [name, run] of CHECKS) {
    if (skip.has(name)) continue;
    process.stdout.write(`  ${name}…\r`);
    await run();
  }
} finally {
  await browser.close();
  site?.close();
}

console.log(`Hollowmere accessibility · ${base}`);
for (const r of results) {
  console.log(`  ${r.name.padEnd(9)} ${r.ok ? '✓' : '✗'} ${r.summary}`);
  for (const d of r.details) console.log(`            ${d}`);
}
const errors = [...new Set(pageErrors)];
if (errors.length) console.log(`  console   ✗ ${errors.length} page error(s)\n${errors.map((e) => `            ✗ ${e}`).join('\n')}`);
const failed = results.filter((r) => !r.ok).length + (errors.length ? 1 : 0);
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
