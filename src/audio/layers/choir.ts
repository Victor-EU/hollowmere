import { mtof, pick, rand } from '../math';
import { chain } from '../nodes';
import { Layer } from './layer';

// Four voices plus a fifth shadowing the lowest a hair sharp (294.4 vs 293.66 Hz in the mockup) for slow beating.
const SHADOW = 294.4 / 293.66;
const CHORDS: readonly (readonly number[])[] = [
  [62, 65, 69, 74], // Dm, the mockup's chord and home
  [62, 65, 70, 74], // Bb/D
  [62, 67, 70, 74], // Gm/D
  [60, 65, 69, 72], // F/C
  [62, 64, 69, 74], // Dsus2
  [60, 64, 69, 72], // Am/C
];
// Wander one step away from Dm and mostly come straight back.
const NEXT: readonly (readonly number[])[] = [[1, 2, 3, 4, 5], [0, 0, 2], [0, 0, 1], [0, 0, 5], [0], [0, 3]];

/** Wordless "ah": detuned saws through two formant bandpasses with a shared vibrato, slow chord changes. */
export class Choir extends Layer {
  private chord = 0;
  private next = 0;
  private voices: OscillatorNode[] = [];

  protected build(t: number): void {
    const pre = this.gain(0.5);
    chain(pre, this.filter('bandpass', 760, 3), this.output);
    chain(pre, this.filter('bandpass', 1150, 4), this.output);
    this.voices = this.pitches().map((f) => {
      const o = this.osc('sawtooth', f, t);
      o.connect(pre);
      return o;
    });
    this.lfo(5.1, 6, t, ...this.voices.map((o) => o.detune));
    this.next = t + this.hold();
  }

  schedule(now: number, until: number): void {
    while (this.next < until) {
      const t = Math.max(this.next, now);
      this.chord = pick(NEXT[this.chord]);
      this.pitches().forEach((f, i) => this.voices[i].frequency.setTargetAtTime(f, t, 0.5));
      this.next = t + this.hold();
    }
  }

  private pitches(): number[] {
    const [a, b, c, d] = CHORDS[this.chord].map(mtof);
    return [a, b, c, d, a * SHADOW];
  }

  private hold(): number {
    return this.chord === 0 ? rand(14, 22) : rand(8, 12);
  }
}
