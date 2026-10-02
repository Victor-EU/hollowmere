import { clamp, rand } from './math';
import { chain, fallEnv, filterNode, gainNode, loopNode, oscNode, pluckEnv } from './nodes';
import type { NoiseBank } from './noise';
import type { AudioEventType } from './types';

/** What a one-shot synth gets: its output (before distance, pan and send), a start time, and helpers that track when it ends. */
export class Kit {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  readonly t: number;
  readonly noise: NoiseBank;
  readonly pan: AudioParam;
  readonly basePan: number;
  /** Context time when the last source stops, and that source. */
  end = 0;
  last: AudioScheduledSourceNode | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode, t: number, noise: NoiseBank, pan: AudioParam, basePan: number) {
    this.ctx = ctx;
    this.out = out;
    this.t = t;
    this.noise = noise;
    this.pan = pan;
    this.basePan = basePan;
  }

  gain(value = 0): GainNode {
    return gainNode(this.ctx, value);
  }

  filter(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode {
    return filterNode(this.ctx, type, freq, q);
  }

  osc(type: OscillatorType, freq: number, start: number, stop: number): OscillatorNode {
    const o = oscNode(this.ctx, type, freq);
    o.start(start);
    return this.track(o, stop);
  }

  noiseSrc(buffer: AudioBuffer, start: number, stop: number): AudioBufferSourceNode {
    const s = loopNode(this.ctx, buffer);
    s.start(start, Math.random() * buffer.duration);
    return this.track(s, stop);
  }

  /** LFO adding ±depth onto each param. */
  lfo(type: OscillatorType, freq: number, depth: number, start: number, stop: number, ...params: AudioParam[]): void {
    const g = this.gain(depth);
    this.osc(type, freq, start, stop).connect(g);
    for (const p of params) g.connect(p);
  }

  private track<T extends AudioScheduledSourceNode>(src: T, stop: number): T {
    src.stop(stop);
    if (stop >= this.end) {
      this.end = stop;
      this.last = src;
    }
    return src;
  }
}

type Synth = (k: Kit) => void;

/** Dragon fire (mockup): noise under a lowpass falling 1400 → 160 Hz over 2.2 s, plus a saw falling 70 → 38 Hz. */
function roar(k: Kit): void {
  const { t } = k;
  const lp = k.filter('lowpass', 1400, 0.8);
  lp.frequency.setValueAtTime(1400, t);
  lp.frequency.exponentialRampToValueAtTime(160, t + 2.2);
  const breath = k.gain();
  fallEnv(breath.gain, t, 0.5, 0.08, 2.2);
  chain(k.noiseSrc(k.noise.white, t, t + 2.3), lp, breath, k.out);

  const saw = k.osc('sawtooth', 70, t, t + 2.4);
  saw.frequency.setValueAtTime(70, t);
  saw.frequency.exponentialRampToValueAtTime(38, t + 2);
  const body = k.gain();
  fallEnv(body.gain, t, 0.18, 0.2, 2.2);
  chain(saw, k.filter('lowpass', 400), body, k.out);
}

/** Passing through a wall (mockup): bandpassed noise sweeping 2600 → 380 Hz over 0.7 s, drifting across the stereo field. */
function whoosh(k: Kit): void {
  const { t } = k;
  const bp = k.filter('bandpass', 2600, 0.8);
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(380, t + 0.7);
  const env = k.gain();
  fallEnv(env.gain, t, 0.22, 0.08, 0.7);
  chain(k.noiseSrc(k.noise.white, t, t + 0.8), bp, env, k.out);
  k.pan.setValueAtTime(clamp(k.basePan - 0.2, -1, 1), t);
  k.pan.linearRampToValueAtTime(clamp(k.basePan + 0.2, -1, 1), t + 0.7);
}

/** One crow caw, sometimes two: a falling, rasping saw through two nasal formants. */
function caw(k: Kit): void {
  let t = k.t;
  const count = Math.random() < 0.4 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const dur = rand(0.26, 0.36);
    const f = rand(470, 560) * (1 - 0.07 * i);
    const stop = t + dur + 0.25;
    const o = k.osc('sawtooth', f, t, stop);
    o.frequency.setTargetAtTime(f * 0.78, t + 0.04, dur * 0.5);
    const rasp = k.gain(0.6);
    k.lfo('square', rand(55, 75), 0.4, t, stop, rasp.gain);
    const env = k.gain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1.6, t + 0.025);
    env.gain.setTargetAtTime(1.1, t + 0.025, 0.1);
    env.gain.setTargetAtTime(0, t + dur - 0.05, 0.04);
    o.connect(rasp);
    chain(rasp, k.filter('bandpass', 1350, 3.5), env);
    chain(rasp, k.filter('bandpass', 2500, 5), k.gain(0.6), env);
    env.connect(k.out);
    t += dur + rand(0.12, 0.22);
  }
}

/** Two soft whumps (down, up): dark noise puffs over a falling sine thump. */
function wingbeat(k: Kit): void {
  for (let i = 0; i < 2; i++) {
    const t = k.t + i * 0.42;
    const amp = i === 0 ? 1 : 0.65;
    const lp = k.filter('lowpass', 520, 1);
    lp.frequency.setTargetAtTime(150, t + 0.03, 0.12);
    const air = k.gain();
    pluckEnv(air.gain, t, 1.6 * amp, 0.05, 0.1);
    chain(k.noiseSrc(k.noise.brown, t, t + 0.8), lp, air, k.out);
    const thump = k.osc('sine', 72, t, t + 0.6);
    thump.frequency.setTargetAtTime(42, t, 0.08);
    const body = k.gain();
    pluckEnv(body.gain, t, 0.5 * amp, 0.02, 0.07);
    chain(thump, body, k.out);
  }
}

/** A ghost's nod: faint breathy noise sliding from "ah" toward "oh". */
function sigh(k: Kit): void {
  const { t } = k;
  const src = k.noiseSrc(k.noise.pink, t, t + 2);
  const f1 = k.filter('bandpass', 820, 4);
  const f2 = k.filter('bandpass', 1250, 5);
  f1.frequency.setTargetAtTime(560, t + 0.3, 0.5);
  f2.frequency.setTargetAtTime(950, t + 0.3, 0.5);
  const env = k.gain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1.6, t + 0.45);
  env.gain.setTargetAtTime(0, t + 0.55, 0.32);
  chain(src, f1, env);
  chain(src, f2, k.gain(0.6), env);
  env.connect(k.out);
}

/** Bats: a quick string of tiny falling chirps on one oscillator. */
function chitter(k: Kit): void {
  const times: number[] = [];
  let t = k.t;
  const n = 6 + Math.floor(Math.random() * 6);
  for (let i = 0; i < n; i++) {
    times.push(t);
    t += Math.random() < 0.15 ? rand(0.1, 0.16) : rand(0.03, 0.07);
  }
  const o = k.osc('sine', 6000, k.t, t + 0.1);
  const g = k.gain();
  // Pitch jumps land while the previous chirp has decayed to silence.
  for (const at of times) {
    const f = rand(4200, 7600);
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * 0.62, at + 0.014);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(rand(0.25, 0.5), at + 0.002);
    g.gain.setTargetAtTime(0, at + 0.004, 0.005);
  }
  chain(o, g, k.out);
}

/** Stone on stone: dark noise and grit, roughened by two uneven amplitude LFOs. */
function grind(k: Kit): void {
  const { t } = k;
  const end = t + 1.5;
  const am = k.gain(0.6);
  k.lfo('sawtooth', rand(9, 13), 0.3, t, end, am.gain);
  k.lfo('square', rand(15, 19), 0.15, t, end, am.gain);
  chain(k.noiseSrc(k.noise.brown, t, end), k.filter('bandpass', 280, 1.4), am);
  chain(k.noiseSrc(k.noise.white, t, end), k.filter('bandpass', 2400, 1.1), k.gain(0.25), am);
  const env = k.gain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(2, t + 0.18);
  env.gain.setTargetAtTime(1.5, t + 0.18, 0.4);
  env.gain.setTargetAtTime(0, t + 1.05, 0.1);
  chain(am, env, k.out);
}

/** Roots and wood: a very low saw (a tick train) whose rate wanders, ringing two woody resonances. */
function creak(k: Kit): void {
  const { t } = k;
  const o = k.osc('sawtooth', 30, t, t + 1.4);
  o.frequency.setTargetAtTime(48, t, 0.25);
  o.frequency.setTargetAtTime(33, t + 0.6, 0.3);
  const env = k.gain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(4, t + 0.1);
  env.gain.setTargetAtTime(0, t + 1, 0.12);
  chain(o, k.filter('bandpass', 470, 9), env);
  chain(o, k.filter('bandpass', 1150, 7), k.gain(0.6), env);
  env.connect(k.out);
}

export const SYNTHS: Record<AudioEventType, Synth> = { roar, whoosh, caw, wingbeat, sigh, chitter, grind, creak };
