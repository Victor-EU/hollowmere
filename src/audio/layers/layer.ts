import { filterNode, gainNode, loopNode, oscNode } from '../nodes';
import type { NoiseBank } from '../noise';

/**
 * One bed of the mix. A layer renders into `output`; the mix owns its fader (zone gain) and reverb send.
 * A composed stem can replace any layer later: a Layer whose build() loops an AudioBufferSourceNode into `output`.
 */
export abstract class Layer {
  readonly output: GainNode;
  protected readonly ctx: BaseAudioContext;
  protected readonly noise: NoiseBank;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private live = false;

  constructor(ctx: BaseAudioContext, noise: NoiseBank, level: number) {
    this.ctx = ctx;
    this.noise = noise;
    this.output = gainNode(ctx, level);
  }

  get running(): boolean {
    return this.live;
  }

  start(t: number): void {
    if (this.live) return;
    this.live = true;
    this.build(t);
  }

  /** Tear everything down. Only called while the layer's fader is silent. */
  stop(): void {
    if (!this.live) return;
    this.live = false;
    for (const s of this.sources) s.stop();
    for (const n of this.nodes) n.disconnect();
    this.sources = [];
    this.nodes = [];
  }

  /** Lookahead hook: schedule whatever starts before `until`. Only called while running. */
  schedule(_now: number, _until: number): void {}

  /** Create and start the layer's sources. Everything made with the helpers below is torn down by stop(). */
  protected abstract build(t: number): void;

  protected gain(value: number): GainNode {
    return this.keep(gainNode(this.ctx, value));
  }

  protected filter(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode {
    return this.keep(filterNode(this.ctx, type, freq, q));
  }

  protected osc(type: OscillatorType, freq: number, t: number, detune = 0): OscillatorNode {
    const o = this.keep(oscNode(this.ctx, type, freq, detune));
    o.start(t);
    this.sources.push(o);
    return o;
  }

  protected loop(buffer: AudioBuffer, t: number): AudioBufferSourceNode {
    const s = this.keep(loopNode(this.ctx, buffer));
    s.start(t, Math.random() * buffer.duration);
    this.sources.push(s);
    return s;
  }

  /** Sine LFO adding ±depth onto each param. */
  protected lfo(freq: number, depth: number, t: number, ...params: AudioParam[]): void {
    const g = this.gain(depth);
    this.osc('sine', freq, t).connect(g);
    for (const p of params) g.connect(p);
  }

  private keep<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}
