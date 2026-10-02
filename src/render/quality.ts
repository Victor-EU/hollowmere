import type { Tier } from '../data/manifest';

/**
 * Quality tiers (design doc §8). A tier is picked at start from the device, then adapted while
 * flying: the pixel ratio comes down first, then the tier, when the frame rate stays low; and it
 * goes back up, the tier first, when there's room again, unless stepping up keeps failing. Phones
 * start low. `?quality=high` (or medium, low) pins a tier and turns adaptation off.
 */

export type QualityName = 'low' | 'medium' | 'high';
const ORDER: readonly QualityName[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  /** The pixel ratio a tier starts at (capped by the screen's), and the least adaptation takes it to before dropping a tier. */
  pixelRatio: { max: number; min: number };
  /** A planar reflection at this fraction of the screen's resolution, or 'probe': a cube map of the lake's view, drawn once. */
  reflection: number | 'probe';
  /** The moon's map. It's drawn once, so this is fixed by the tier you start on. */
  shadowMap: number;
  msaa: number;
  bloomMips: number;
  /** Which KTX2 files stream in; also fixed by the starting tier. */
  textures: Tier;
  /** Below this many frames a second, step down. */
  floor: number;
}

export const QUALITY: Record<QualityName, QualitySettings> = {
  high: { pixelRatio: { max: 1.5, min: 1 }, reflection: 0.5, shadowMap: 2048, msaa: 4, bloomMips: 5, textures: 'desktop', floor: 38 },
  medium: { pixelRatio: { max: 1, min: 0.85 }, reflection: 0.33, shadowMap: 2048, msaa: 2, bloomMips: 4, textures: 'desktop', floor: 38 },
  // A three-year-old phone should hold 30 (§8), so only drop below that.
  low: { pixelRatio: { max: 1, min: 0.75 }, reflection: 'probe', shadowMap: 1024, msaa: 0, bloomMips: 3, textures: 'mobile', floor: 26 },
};

/** Seconds per frame-rate sample. */
const WINDOW = 2.5;
/** Seconds to ignore after a start or a change: shader compiles and texture uploads. */
const SETTLE = 4;
/** Samples in a row above this rate before stepping back up. */
const ROOM = { fps: 55, samples: 6 };
/** A step down this soon (seconds) after a step up means the step up failed. */
const BOUNCE = 30;
/** Failed steps up before it stops trying, so a device on the edge doesn't seesaw. */
const MAX_BOUNCES = 2;
const STORE = 'hollowmere.quality';

const step = (name: QualityName, by: number) => ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(name) + by))];
const rank = (name: QualityName) => ORDER.indexOf(name);

/** The GPU's name, without the deprecation warning Firefox gives for the debug extension. */
function gpuName(gl: WebGL2RenderingContext): string {
  const plain = String(gl.getParameter(gl.RENDERER) ?? '');
  if (plain && !/^webkit webgl$/i.test(plain)) return plain;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : plain;
}

function detect(gpu: string): { name: QualityName; why: string } {
  const g = gpu.toLowerCase();
  const coarse = matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(screen.width, screen.height);
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(g)) return { name: 'low', why: 'software renderer' };
  if (coarse && shortSide < 600) return { name: 'low', why: 'phone' };
  if ((nav.deviceMemory ?? 8) <= 2 || (navigator.hardwareConcurrency || 8) <= 2) return { name: 'low', why: 'little memory or few cores' };
  if (coarse) return { name: 'medium', why: 'tablet' };
  if (/intel|mali|adreno|powervr/.test(g)) return { name: 'medium', why: 'integrated GPU' };
  return { name: 'high', why: 'default' };
}

function readStore(): { gpu: string; name: QualityName } | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { gpu: string; name: QualityName } | null;
    return v && ORDER.includes(v.name) ? v : null;
  } catch {
    return null;
  }
}

export class Quality {
  name: QualityName;
  pixelRatio = 1;
  /** Fixed by the tier at start (see QualitySettings). */
  readonly shadowMap: number;
  readonly textures: Tier;
  /** Set by ?quality=; no adaptation then. */
  readonly pinned: boolean;
  readonly gpu: string;
  /** What changed and why, oldest first; for the stats overlay. */
  readonly log: string[] = [];
  private ceiling: QualityName;
  private onBattery = false;
  private listeners: (() => void)[] = [];
  private frames = 0;
  private time = 0;
  private settle = SETTLE;
  private roomy = 0;
  /** Seconds of steady frames counted, and when the last step up was. */
  private clock = 0;
  private lastUp = -Infinity;
  private bounces = 0;

  constructor(gl: WebGL2RenderingContext, params: URLSearchParams) {
    this.gpu = gpuName(gl);
    const asked = params.get('quality') as QualityName | null;
    this.pinned = !!asked && ORDER.includes(asked);
    let start = this.pinned ? { name: asked!, why: 'asked for in the URL' } : detect(this.gpu);
    this.ceiling = start.name;
    const stored = this.pinned ? null : readStore();
    if (stored && stored.gpu === this.gpu && rank(stored.name) < rank(start.name)) start = { name: stored.name, why: `settled there last visit (${start.why} said ${start.name})` };
    this.name = start.name;
    this.pixelRatio = this.maxRatio();
    this.shadowMap = QUALITY[this.name].shadowMap;
    this.textures = QUALITY[this.name].textures;
    this.note(`${this.name}: ${start.why}`);
    if (!this.pinned) this.watchBattery();
  }

  get settings(): QualitySettings {
    return QUALITY[this.name];
  }

  /** Call `fn` whenever the tier or the pixel ratio changes. */
  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  /**
   * Feed each frame's real duration. Pass `steady` false while the frame rate says nothing about
   * the GPU: the tab hidden, the 30 fps cap on, or a deliberate pause.
   */
  frame(dt: number, steady = true): void {
    if (this.pinned) return;
    if (!steady) {
      this.frames = this.time = 0;
      this.settle = Math.max(this.settle, 1);
      return;
    }
    if (this.settle > 0) {
      this.settle -= dt;
      return;
    }
    this.frames++;
    this.time += dt;
    this.clock += dt;
    if (this.time < WINDOW) return;
    const fps = this.frames / this.time;
    this.frames = this.time = 0;
    if (fps < this.settings.floor) {
      this.roomy = 0;
      this.down(fps);
    } else if (fps >= ROOM.fps && this.bounces < MAX_BOUNCES && this.canRise()) {
      if (++this.roomy >= ROOM.samples) {
        this.roomy = 0;
        this.lastUp = this.clock;
        this.up(fps);
      }
    } else this.roomy = 0;
  }

  private maxRatio(name = this.name) {
    return Math.min(window.devicePixelRatio || 1, QUALITY[name].pixelRatio.max);
  }

  private canRise() {
    return this.pixelRatio < this.maxRatio() - 0.01 || rank(this.name) < rank(this.allowed());
  }

  /** The best tier allowed right now: the start's, or low while on battery (design doc §19). */
  private allowed(): QualityName {
    return this.onBattery ? 'low' : this.ceiling;
  }

  private down(fps: number) {
    if (this.clock - this.lastUp < BOUNCE) this.bounces++;
    const s = this.settings;
    const floor = Math.min(s.pixelRatio.min, this.maxRatio());
    if (this.pixelRatio > floor + 0.01) {
      this.pixelRatio = Math.max(floor, this.pixelRatio * 0.8);
      this.changed(`pixel ratio ${this.pixelRatio.toFixed(2)}: ${fps.toFixed(0)} fps`);
    } else if (this.name !== 'low') {
      this.name = step(this.name, -1);
      this.pixelRatio = this.maxRatio();
      this.changed(`${this.name}: ${fps.toFixed(0)} fps`);
    }
  }

  /** The tier first, starting at its lowest pixel ratio: it's the bigger difference to look at. */
  private up(fps: number) {
    if (rank(this.name) < rank(this.allowed())) {
      this.name = step(this.name, 1);
      this.pixelRatio = Math.min(this.maxRatio(), QUALITY[this.name].pixelRatio.min);
      this.changed(`${this.name}: ${fps.toFixed(0)} fps`);
    } else {
      this.pixelRatio = Math.min(this.maxRatio(), this.pixelRatio / 0.8);
      this.changed(`pixel ratio ${this.pixelRatio.toFixed(2)}: ${fps.toFixed(0)} fps`);
    }
  }

  private watchBattery() {
    const nav = navigator as Navigator & { getBattery?: () => Promise<EventTarget & { charging: boolean }> };
    nav.getBattery?.().then(
      (b) => {
        const check = () => {
          const on = !b.charging;
          if (on === this.onBattery) return;
          this.onBattery = on;
          if (on && this.name !== 'low') {
            this.name = 'low';
            this.pixelRatio = this.maxRatio();
            this.changed('low: on battery', false);
          } else if (!on && rank(this.name) < rank(this.ceiling)) {
            this.name = this.ceiling;
            this.pixelRatio = this.maxRatio();
            this.bounces = 0;
            this.changed(`${this.name}: charging`, false);
          }
        };
        b.addEventListener('chargingchange', check);
        check();
      },
      () => undefined,
    );
  }

  private changed(why: string, remember = true) {
    this.note(why);
    this.frames = this.time = 0;
    this.settle = SETTLE;
    // Next visit on this GPU starts where adaptation settled, rather than stuttering down again.
    if (remember) {
      try {
        localStorage.setItem(STORE, JSON.stringify({ gpu: this.gpu, name: this.name }));
      } catch {
        // Private mode: start from detection each time.
      }
    }
    for (const fn of this.listeners) fn();
  }

  private note(why: string) {
    this.log.push(why);
    if (this.log.length > 8) this.log.shift();
  }
}
