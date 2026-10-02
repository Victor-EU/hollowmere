import { mtof, pick, rand } from '../math';
import { chain, strike, type Overtone } from '../nodes';
import { Layer } from './layer';

// D6, F6, A6 alone or in short falling/rising figures.
const FIGURES: readonly (readonly number[])[] = [[86], [89], [93], [86, 93], [89, 86], [93, 89, 86], [86, 89, 93], [93, 86]];
const GLASS: readonly Overtone[] = [
  [1, 1, 3.5],
  [2.76, 0.25, 1],
  [5.4, 0.08, 0.35],
];

/** Above ~100 m: a thin, cold, high-passed wind and sparse high bell notes. Kept under the choir. */
export class Heights extends Layer {
  private next = 0;
  private notes: GainNode | null = null;

  protected build(t: number): void {
    const bp = this.filter('bandpass', 2600, 1.2);
    const gust = this.gain(0.55);
    chain(this.loop(this.noise.white, t), this.filter('highpass', 1400, 0), bp, gust, this.gain(0.06), this.output);
    this.lfo(0.06, 900, t, bp.frequency);
    this.lfo(0.11, 0.2, t, gust.gain);
    this.lfo(0.037, 0.15, t, gust.gain);

    this.notes = this.gain(1);
    this.notes.connect(this.output);
    this.next = t + rand(3, 6);
  }

  schedule(now: number, until: number): void {
    const out = this.notes;
    if (!out) return;
    while (this.next < until) {
      const t = Math.max(this.next, now);
      const figure = pick(FIGURES);
      const gap = rand(0.55, 0.9);
      figure.forEach((m, i) => strike(this.ctx, out, t + i * gap, mtof(m), 0.02 * rand(0.7, 1), GLASS, 0.004));
      this.next = t + figure.length * gap + rand(4, 10);
    }
  }
}
