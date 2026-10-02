import { mtof, pick, rand } from '../math';
import { strike, type Overtone } from '../nodes';
import { Layer } from './layer';

// D6, F6, A6 alone or in short falling/rising figures.
const FIGURES: readonly (readonly number[])[] = [[86], [89], [93], [86, 93], [89, 86], [93, 89, 86], [86, 89, 93], [93, 86]];
const GLASS: readonly Overtone[] = [
  [1, 1, 3.5],
  [2.76, 0.25, 1],
  [5.4, 0.08, 0.35],
];

/** Above ~100 m: sparse high bell notes, kept under the choir. */
export class Heights extends Layer {
  private next = 0;
  private notes: GainNode | null = null;

  protected build(t: number): void {
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
