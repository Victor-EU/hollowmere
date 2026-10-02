import { rand } from '../math';
import { strike, type Overtone } from '../nodes';
import { Layer } from './layer';

const FUNDAMENTAL = 98; // G2: hum an octave below, minor-third tierce at 1.19
const PARTIALS: readonly Overtone[] = [
  [0.5, 0.5, 9],
  [1, 0.8, 7],
  [1.19, 0.35, 5],
  [1.56, 0.25, 4],
  [2, 0.3, 4],
  [2.66, 0.15, 3],
  [3.01, 0.12, 2.5],
];

/** A distant toll about every 24 s (±4 s), inharmonic partials, heavy reverb. Global. */
export class Bell extends Layer {
  private next = 0;

  protected build(t: number): void {
    this.next = t + 6;
  }

  schedule(now: number, until: number): void {
    if (this.next < now - 1) this.next = now;
    while (this.next < until) {
      strike(this.ctx, this.output, Math.max(this.next, now), FUNDAMENTAL, 0.12, PARTIALS);
      this.next += 24 + rand(-4, 4);
    }
  }
}
