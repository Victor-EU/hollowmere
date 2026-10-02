import { chain } from '../nodes';
import { Smoothed } from '../params';
import { Layer } from './layer';

// D2 as two saws half a hertz apart (slow beating), A2, and a slightly flat D3 that beats against the saws' octave.
const DRONE: readonly (readonly [number, OscillatorType])[] = [
  [73.42, 'sawtooth'],
  [73.9, 'sawtooth'],
  [110, 'triangle'],
  [146.4, 'triangle'],
];

/** Wind over a low drone. Always on. Values follow the mockup. */
export class BaseLayer extends Layer {
  private wind: Smoothed | null = null;
  private tone: Smoothed | null = null;

  protected build(t: number): void {
    // Wind: looping noise through a slowly wandering bandpass.
    const bp = this.filter('bandpass', 420, 0.7);
    const wind = this.gain(0.12);
    chain(this.loop(this.noise.white, t), bp, wind, this.output);
    this.lfo(0.07, 260, t, bp.frequency);

    const lp = this.filter('lowpass', 340, 0.8);
    const drone = this.gain(0.05);
    chain(lp, drone, this.output);
    for (const [f, type] of DRONE) this.osc(type, f, t).connect(lp);
    this.lfo(0.11, 0.02, t, drone.gain);

    this.wind = new Smoothed(wind.gain, 0.5);
    this.tone = new Smoothed(bp.frequency, 0.5, 0.01);
  }

  /** alt and speed are 0..1. The wind gets louder and a little brighter with both. */
  steer(alt: number, speed: number, t: number): void {
    this.wind?.set(0.07 + 0.11 * alt + 0.07 * speed, t);
    this.tone?.set(420 + 160 * alt + 140 * speed, t);
  }
}
