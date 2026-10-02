import { clamp, mtof, pick } from '../math';
import { chain, fallEnv, gainNode, oscNode } from '../nodes';
import { Layer } from './layer';

const SCALE = [62, 65, 67, 69, 72, 74, 77, 81].map(mtof); // D4 F4 G4 A4 C5 D5 F5 A5
const STEPS = [-2, -1, -1, 1, 1, 2, 0];
const GAPS = [0.9, 1.4, 1.8, 2.6, 3.4];

/** A slow random walk over D minor, as in the mockup: never the same twice, with breaths between notes. Global. */
export class MusicBox extends Layer {
  private next = 0;
  private idx = 3;

  protected build(t: number): void {
    this.next = t + 1.5;
  }

  schedule(now: number, until: number): void {
    if (this.next < now - 1) this.next = now;
    while (this.next < until) {
      const t = Math.max(this.next, now);
      this.idx = clamp(this.idx + pick(STEPS), 0, SCALE.length - 1);
      this.note(t, SCALE[this.idx], 0.07);
      // Sometimes a soft lower note under it, a third or fourth down and an octave below.
      if (Math.random() < 0.3) this.note(t + 0.02, SCALE[Math.max(0, this.idx - 2)] / 2, 0.05);
      this.next += pick(GAPS);
    }
  }

  /** Sine plus a quiet triangle an octave up; 8 ms attack, 2.8 s fall. */
  private note(t: number, f: number, peak: number): void {
    const { ctx } = this;
    const env = gainNode(ctx);
    fallEnv(env.gain, t, peak, 0.008, 2.8, 0.0008);
    const sine = oscNode(ctx, 'sine', f);
    const tri = oscNode(ctx, 'triangle', f * 2.001);
    sine.connect(env);
    chain(tri, gainNode(ctx, 0.25), env);
    env.connect(this.output);
    for (const o of [sine, tri]) {
      o.start(t);
      o.stop(t + 3);
    }
  }
}
