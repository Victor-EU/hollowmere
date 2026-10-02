import type { Zone } from '../data';
import { Mix, type MixStatus } from './mix';
import { StemLibrary } from './stems';
import type { AudioEventType, ListenerState } from './types';
import type { Point3 } from './zones';

const PREF_KEY = 'hollowmere.sound';

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    // Storage blocked (private mode): the choice lasts for this visit only.
  }
}

function settle(p: Promise<void>): void {
  p.catch(() => undefined);
}

export class AudioEngine {
  private readonly zones: Zone[];
  private mix: Mix | null = null;
  private enabled = false;
  private paused = false;
  private wants: boolean;
  private listener: ListenerState = { position: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 0 };
  private suspendTimer = 0;
  private readonly decodeRate: number | undefined;

  /** `decodeRate`: decode the music at this sample rate, to save memory on small devices. */
  constructor(zones: Zone[], { decodeRate }: { decodeRate?: number } = {}) {
    this.zones = zones;
    this.wants = readPref();
    this.decodeRate = decodeRate;
  }

  /** True once the AudioContext exists and sound is on. */
  get on(): boolean {
    return this.mix !== null && this.enabled;
  }

  /** Persisted preference (localStorage 'hollowmere.sound', '1' or '0'; default off). */
  get wantsSound(): boolean {
    return this.wants;
  }

  /** Call from a user gesture. Creates the context on first use, toggles sound, persists the preference, returns the new state. */
  async toggle(): Promise<boolean> {
    const on = !this.on;
    if (on && !this.start()) return false;
    if (!on) this.stop();
    this.wants = on;
    writePref(on);
    if (on) await this.resume();
    return this.on;
  }

  /** Call from a user gesture when wantsSound is true but the context does not exist yet. Turns sound on without changing the preference. */
  async resumeFromGesture(): Promise<void> {
    if (!this.wants) return;
    if (!this.on && !this.start()) return;
    await this.resume();
  }

  /** Per frame. Cheap: just updates smoothed gains/filters. No-op while off. */
  update(state: ListenerState, dt: number): void {
    this.listener = state;
    if (this.enabled && !this.paused && this.mix) this.mix.update(state, dt);
  }

  /** One-shot; `at` omitted means at the listener. */
  trigger(type: AudioEventType, at?: Point3): void {
    if (this.enabled && !this.paused && this.mix) this.mix.trigger(type, at, this.listener);
  }

  /** What's playing; null before sound has first been turned on. */
  status(): MixStatus | null {
    return this.mix?.status() ?? null;
  }

  /** Tab hidden / shown: suspend and resume the context. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const mix = this.mix;
    if (!mix) return;
    if (paused) {
      mix.scheduler.stop();
      settle(mix.ctx.suspend());
    } else if (this.enabled) {
      mix.scheduler.start();
      settle(mix.ctx.resume());
    }
  }

  // Synchronous so the context is created and resumed inside the user gesture (iOS needs both).
  private start(): boolean {
    if (!this.mix) {
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ latencyHint: 'balanced' });
      } catch {
        return false;
      }
      unlock(ctx);
      this.mix = new Mix(ctx, this.zones, new StemLibrary(ctx, new URL('assets/', document.baseURI), this.decodeRate));
    }
    window.clearTimeout(this.suspendTimer);
    this.enabled = true;
    this.mix.fade(true);
    this.mix.update(this.listener, 0);
    if (this.paused) settle(this.mix.ctx.suspend());
    else this.mix.scheduler.start();
    return true;
  }

  private async resume(): Promise<void> {
    const mix = this.mix;
    if (!mix || this.paused || !this.enabled) return;
    try {
      await mix.ctx.resume();
    } catch {
      // Still suspended; the next gesture retries.
    }
  }

  /** Fade out, then suspend the context so a muted page costs nothing. */
  private stop(): void {
    const mix = this.mix;
    if (!mix) return;
    this.enabled = false;
    mix.fade(false);
    mix.scheduler.stop();
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = window.setTimeout(() => {
      if (!this.enabled) settle(mix.ctx.suspend());
    }, 600);
  }
}

/** Older iOS only unlocks output once something has played inside a gesture. */
function unlock(ctx: AudioContext): void {
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  src.connect(ctx.destination);
  src.start();
}
