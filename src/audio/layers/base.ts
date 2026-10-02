import { chain } from '../nodes';
import { Layer } from './layer';

// D2 as two saws half a hertz apart (slow beating), A2, and a slightly flat D3 that beats against the saws' octave.
const DRONE: readonly (readonly [number, OscillatorType])[] = [
  [73.42, 'sawtooth'],
  [73.9, 'sawtooth'],
  [110, 'triangle'],
  [146.4, 'triangle'],
];

/** A low drone, always on. (It had wind over it, louder with speed and height; that sounded like flying machinery, not night air.) */
export class BaseLayer extends Layer {
  protected build(t: number): void {
    const lp = this.filter('lowpass', 340, 0.8);
    const drone = this.gain(0.05);
    chain(lp, drone, this.output);
    for (const [f, type] of DRONE) this.osc(type, f, t).connect(lp);
    this.lfo(0.11, 0.02, t, drone.gain);
  }
}
