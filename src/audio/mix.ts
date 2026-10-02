import type { AudioLayerName, Zone } from '../data';
import { EventPlayer } from './events';
import { BaseLayer } from './layers/base';
import { Bell } from './layers/bell';
import { Choir } from './layers/choir';
import { Gate } from './layers/gate';
import { Heights } from './layers/heights';
import type { Layer } from './layers/layer';
import { MusicBox } from './layers/musicbox';
import { Scored, type Clock } from './layers/stem';
import { clamp, smoothstep } from './math';
import { chain, gainNode } from './nodes';
import { createNoiseBank } from './noise';
import { Smoothed } from './params';
import { createReverb } from './reverb';
import { Scheduler } from './scheduler';
import type { StemLibrary } from './stems';
import type { AudioEventType, ListenerState } from './types';
import { zoneDistance, zoneGain, type Point3 } from './zones';

const MASTER = 0.85;
/** Zone layers below this fader target count as silent... */
const QUIET = 0.001;
/** ...and are torn down after this many seconds of silence, to save CPU. */
const SLEEP_AFTER = 5;

interface ZoneSlot {
  layer: Layer;
  zone: AudioLayerName;
  fader: Smoothed;
  quiet: number;
}

/** What's playing, for tests and the console. */
export interface MixStatus {
  /** 'synth', 'loading', or 'stem <variant>'; the choir is 'asleep' outside its zones. */
  musicbox: string;
  choir: string;
  /** Layers whose stems have decoded. */
  loaded: string[];
  /** 'opus' or 'aac', and any stem files that failed to fetch or decode. */
  format: string;
  failed: string[];
}

/**
 * The audio graph for one context:
 *   layer → fader → bus → compressor → master (the on/off fade) → speakers
 *   fader → send → shared reverb → bus
 * The music box and the choir are scored: composed stems once they've loaded, synth until then.
 */
export class Mix {
  readonly ctx: AudioContext;
  readonly scheduler: Scheduler;
  private readonly master: GainNode;
  private readonly base: BaseLayer;
  private readonly music: Scored;
  private readonly choir: Scored;
  private readonly library: StemLibrary;
  private readonly layers: Layer[];
  private readonly zoned: ZoneSlot[];
  private readonly events: EventPlayer;
  private readonly zones: Record<AudioLayerName, Zone[]> = { choir: [], gate: [], heights: [] };

  constructor(ctx: AudioContext, zones: Zone[], library: StemLibrary) {
    this.ctx = ctx;
    this.library = library;
    for (const z of zones) if (z.layer) this.zones[z.layer].push(z);
    const noise = createNoiseBank(ctx);

    const bus = gainNode(ctx, 1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    this.master = gainNode(ctx, 0);
    chain(bus, comp, this.master, ctx.destination);
    const reverb = createReverb(ctx);
    reverb.output.connect(bus);

    const mount = (layer: Layer, send: number, level: number): GainNode => {
      const fader = gainNode(ctx, level);
      chain(layer.output, fader, bus);
      chain(fader, gainNode(ctx, send), reverb.input);
      return fader;
    };
    const zoned = (layer: Layer, zone: AudioLayerName, send: number): ZoneSlot => ({
      layer,
      zone,
      fader: new Smoothed(mount(layer, send, 0).gain, 0.6),
      quiet: 0,
    });

    // Music box and choir play dry at 0.35 with the full signal sent to the reverb, as in the mockup.
    // Their stems are loudness-matched to these synth levels by tools/stems.ts.
    const clock: Clock = { t0: null };
    this.base = new BaseLayer(ctx, noise, 1);
    const music = new Scored(ctx, noise, new MusicBox(ctx, noise, 0.35), library, clock, 'musicbox');
    const bell = new Bell(ctx, noise, 1);
    mount(this.base, 1, 1);
    mount(music, 1 / 0.35, 1);
    mount(bell, 1, 1);
    this.music = music;
    this.choir = new Scored(ctx, noise, new Choir(ctx, noise, 0.35), library, clock, 'choir');
    this.zoned = [
      zoned(this.choir, 'choir', 1 / 0.35),
      zoned(new Gate(ctx, noise, 1), 'gate', 0.5),
      zoned(new Heights(ctx, noise, 1), 'heights', 0.7),
    ];
    this.layers = [this.base, music, bell, ...this.zoned.map((s) => s.layer)];
    const t = ctx.currentTime;
    for (const l of [this.base, music, bell]) l.start(t);

    const events = gainNode(ctx, 1);
    events.connect(bus);
    this.events = new EventPlayer(ctx, events, reverb.input, noise);

    this.scheduler = new Scheduler(ctx, (now, until) => {
      for (const l of this.layers) if (l.running) l.schedule(now, until);
    });
    void library.prefetch();
  }

  status(): MixStatus {
    return {
      musicbox: this.music.mode,
      choir: this.choir.running ? this.choir.mode : 'asleep',
      loaded: [this.music.loaded && 'musicbox', this.choir.loaded && 'choir'].filter((s): s is string => !!s),
      format: this.library.format,
      failed: [...this.library.failed],
    };
  }

  /** Master in over ~2 s, out over ~0.4 s. */
  fade(on: boolean): void {
    const t = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(on ? MASTER : 0, t, on ? 0.5 : 0.1);
  }

  update(l: ListenerState, dt: number): void {
    const t = this.ctx.currentTime;
    const p = l.position;
    this.base.steer(smoothstep(40, 200, p.y), clamp(l.speed / 30, 0, 1), t);
    for (const s of this.zoned) {
      const target = this.target(s.zone, p);
      s.fader.set(target, t);
      if (target > QUIET) {
        s.quiet = 0;
        s.layer.start(t);
      } else if (s.layer.running && (s.quiet += Math.min(dt, 1)) > SLEEP_AFTER) {
        s.layer.stop();
      }
    }
  }

  trigger(type: AudioEventType, at: Point3 | undefined, l: ListenerState): void {
    this.events.play(type, at, l);
  }

  /**
   * Fader level for a zone layer: the strongest zone of that layer. The choir is shaped to the mockup's hall
   * curve (0.09 near the hall, easing out over ~100 m, plus 0.04 once inside).
   */
  private target(name: AudioLayerName, p: Point3): number {
    let g = 0;
    for (const z of this.zones[name]) g = Math.max(g, zoneGain(z, p));
    if (name !== 'choir') return g;
    const inside = this.zones.choir.some((z) => zoneDistance(z.shape, p) === 0);
    return 0.09 * Math.sqrt(g) + (inside ? 0.04 : 0);
  }
}
