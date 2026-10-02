import type { ManifestStem } from '../../data/manifest';
import { pick } from '../math';
import type { NoiseBank } from '../noise';
import type { StemLibrary } from '../stems';
import { Layer } from './layer';

/** Shared by every stem so they all count cycles from the same moment and stay on the same chord. */
export interface Clock {
  t0: number | null;
}

/** Seconds each cycle overlaps the next. Opus never repeats exactly, so a jump would click. */
const XFADE = 0.12;
/** Synth to stem, once the stem has decoded. */
const HANDOVER = 4;

interface Playing {
  src: AudioBufferSourceNode;
  env: GainNode;
  variant: number;
  /** Context time this cycle ends (its source runs XFADE / 2 past it). */
  end: number;
}

/**
 * A layer that plays a composed stem when the manifest has one, and its synth stand-in until the
 * stem has downloaded and decoded (or for good, when there is no stem or it can't be decoded).
 * The stem plays one cycle per buffer source, each crossfading into the next. With several
 * variants a different one is picked each time round.
 */
export class Scored extends Layer {
  private readonly synth: Layer;
  private readonly library: StemLibrary;
  private readonly clock: Clock;
  private readonly name: ManifestStem['layer'];
  private readonly synthFade: GainNode;
  private readonly stemFade: GainNode;
  private readonly stemGain: GainNode;
  private stem: ManifestStem | null = null;
  /** Decoded variants, by index. */
  private readonly ready = new Map<number, AudioBuffer>();
  private loading = false;
  private playing: Playing[] = [];
  private synthOff = Infinity;
  /** The variant chosen for the next cycle, decoding while the current one plays. */
  private nextVariant = 0;

  constructor(ctx: BaseAudioContext, noise: NoiseBank, synth: Layer, library: StemLibrary, clock: Clock, name: ManifestStem['layer']) {
    super(ctx, noise, 1);
    this.synth = synth;
    this.library = library;
    this.clock = clock;
    this.name = name;
    this.synthFade = ctx.createGain();
    this.stemFade = ctx.createGain();
    this.stemGain = ctx.createGain();
    this.stemFade.gain.value = 0;
    synth.output.connect(this.synthFade).connect(this.output);
    this.stemGain.connect(this.stemFade).connect(this.output);
    // Decode straight away, so a zone layer that wakes later starts on its stem.
    void library.forLayer(name).then((stem) => {
      this.stem = stem;
      if (stem) this.stemGain.gain.value = stem.gain;
      this.load();
    });
  }

  /** True once the stem has decoded. */
  get loaded(): boolean {
    return this.ready.size > 0;
  }

  /** 'synth', 'loading' or 'stem', and which variant is playing; for the status readout. */
  get mode(): string {
    if (this.ready.size && this.stemFade.gain.value > 0.5) return `stem ${this.playing.at(-1)?.variant ?? '-'}`;
    return this.loading ? 'loading' : 'synth';
  }

  protected build(t: number): void {
    if (this.ready.size) {
      this.synthFade.gain.setValueAtTime(0, t);
      this.stemFade.gain.setValueAtTime(1, t);
    } else {
      this.synth.start(t);
      this.synthFade.gain.setValueAtTime(1, t);
      this.stemFade.gain.setValueAtTime(0, t);
      this.load();
    }
  }

  stop(): void {
    super.stop();
    this.synth.stop();
    this.synthOff = Infinity;
    for (const p of this.playing) {
      p.src.stop();
      p.env.disconnect();
    }
    this.playing = [];
  }

  schedule(now: number, until: number): void {
    if (this.synth.running) {
      if (now > this.synthOff) {
        this.synth.stop();
        this.synthOff = Infinity;
      } else this.synth.schedule(now, until);
    }
    const stem = this.stem;
    if (!stem || !this.ready.size) return;
    this.playing = this.playing.filter((p) => p.end + XFADE > now);
    const L = stem.loopLength;
    // Nothing playing (just started, or back from silence): join the shared cycle where it is.
    if (!this.playing.length) {
      const t = now + 0.05;
      this.clock.t0 ??= t;
      const k = Math.floor((t - this.clock.t0) / L);
      this.cycle(this.pickReady(), this.clock.t0 + k * L, t);
    }
    // The next cycle starts half a crossfade early.
    const last = this.playing[this.playing.length - 1];
    if (last.end - XFADE / 2 < until) this.cycle(this.ready.has(this.nextVariant) ? this.nextVariant : last.variant, last.end, last.end - XFADE / 2);
  }

  /** Start variant `v` for the cycle beginning at `start`, sounding from `from` (later than start when joining midway). */
  private cycle(v: number, start: number, from: number): void {
    const stem = this.stem!;
    const L = stem.loopLength;
    const src = this.ctx.createBufferSource();
    src.buffer = this.ready.get(v)!;
    const env = this.ctx.createGain();
    const end = start + L;
    const fadeIn = from < start + XFADE / 2;
    env.gain.setValueAtTime(fadeIn ? 0 : 1, from);
    if (fadeIn) env.gain.linearRampToValueAtTime(1, start + XFADE / 2);
    env.gain.setValueAtTime(1, end - XFADE / 2);
    env.gain.linearRampToValueAtTime(0, end + XFADE / 2);
    src.connect(env).connect(this.stemGain);
    src.start(from, stem.loopStart + (from - start));
    src.stop(end + XFADE / 2 + 0.02);
    src.onended = () => env.disconnect();
    this.playing.push({ src, env, variant: v, end });
    this.chooseNext(v);
  }

  /** Pick the next cycle's variant (never the same twice running), decode it, and let go of the rest. */
  private chooseNext(current: number): void {
    const stem = this.stem!;
    const n = stem.variants.length;
    if (n < 2) return;
    this.nextVariant = pick([...Array(n).keys()].filter((i) => i !== current));
    for (const i of [...this.ready.keys()]) {
      if (i !== current && i !== this.nextVariant) {
        this.ready.delete(i);
        this.library.release(stem, i);
      }
    }
    const next = this.nextVariant;
    void this.library.buffer(stem, next).then(
      (b) => {
        if (this.nextVariant === next) this.ready.set(next, b);
      },
      () => undefined,
    );
  }

  private pickReady(): number {
    return this.ready.has(this.nextVariant) ? this.nextVariant : [...this.ready.keys()][0];
  }

  /** Fetch and decode the first variant, then hand over from the synth if it's playing. */
  private load(): void {
    const stem = this.stem;
    if (!stem || this.loading || this.ready.size) return;
    this.loading = true;
    this.library.buffer(stem, 0).then(
      (b) => {
        this.loading = false;
        this.ready.set(0, b);
        if (!this.synth.running) return;
        const t = this.ctx.currentTime;
        this.synthFade.gain.setTargetAtTime(0, t, HANDOVER / 4);
        this.stemFade.gain.setTargetAtTime(1, t, HANDOVER / 4);
        this.synthOff = t + HANDOVER * 1.5;
      },
      (err: Error) => {
        this.loading = false;
        this.stem = null;
        console.warn(`audio: ${err.message}; keeping the synth ${this.name}`);
      },
    );
  }
}
