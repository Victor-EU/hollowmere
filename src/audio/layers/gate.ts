import { mtof, pick, rand } from '../math';
import { chain, filterNode, gainNode, loopNode, pluckEnv } from '../nodes';
import { Layer } from './layer';

const LOW = 50; // D3, held
const UPPER = [57, 58, 57, 55, 57, 53]; // A3 Bb3 A3 G3 A3 F3: a slow sighing line over it
const LINKS = [1, 1.32, 1.61, 2.05]; // pitch ratios between chain links

/** Gate courtyard: occasional chain rattles, low sustained strings, fire crackle. Kept well under the choir. */
export class Gate extends Layer {
  private nextRattle = 0;
  private nextMove = 0;
  private step = 0;
  private upper: OscillatorNode[] = [];
  private chains: GainNode | null = null;

  protected build(t: number): void {
    // Strings: three detuned saws per voice, lowpassed, slowly swelling.
    const lp = this.filter('lowpass', 620, 2);
    const swell = this.gain(0.6);
    chain(lp, swell, this.gain(0.012), this.output);
    this.lfo(0.043, 0.3, t, swell.gain);
    for (const cents of [-9, 0, 8]) this.osc('sawtooth', mtof(LOW), t, cents).connect(lp);
    this.upper = [-8, 2, 11].map((cents) => {
      const o = this.osc('sawtooth', mtof(UPPER[this.step]), t, cents);
      o.connect(lp);
      return o;
    });

    // Fire: looped crackle over a low, flickering roar.
    chain(this.loop(this.noise.crackle, t), this.filter('highpass', 800, 0), this.gain(0.06), this.output);
    const flicker = this.gain(0.02);
    chain(this.loop(this.noise.brown, t), this.filter('lowpass', 350, 0), flicker, this.output);
    this.lfo(0.9, 0.006, t, flicker.gain);
    this.lfo(2.3, 0.004, t, flicker.gain);

    this.chains = this.gain(0.05);
    this.chains.connect(this.output);
    this.nextRattle = t + rand(1.5, 5);
    this.nextMove = t + rand(6, 10);
  }

  schedule(now: number, until: number): void {
    while (this.nextRattle < until) {
      this.rattle(Math.max(this.nextRattle, now));
      this.nextRattle += rand(7, 16);
    }
    while (this.nextMove < until) {
      this.step = (this.step + 1) % UPPER.length;
      const f = mtof(UPPER[this.step]);
      for (const o of this.upper) o.frequency.setTargetAtTime(f, Math.max(this.nextMove, now), 0.9);
      this.nextMove += rand(10, 18);
    }
  }

  /** A burst of clinks that thins out as the links settle. */
  private rattle(t: number): void {
    const out = this.chains;
    if (!out) return;
    const n = 5 + Math.floor(Math.random() * 10);
    const base = rand(2300, 3400);
    let at = t;
    for (let i = 0; i < n; i++) {
      const settle = i / n;
      this.clink(out, at, base * pick(LINKS) * rand(0.97, 1.03), (1 - 0.6 * settle) * rand(0.4, 1));
      at += rand(0.03, 0.1) * (1 + settle);
    }
  }

  /** A few ms of noise ringing two resonant bandpasses a non-integer ratio apart. */
  private clink(out: AudioNode, t: number, f: number, amp: number): void {
    const { ctx } = this;
    const src = loopNode(ctx, this.noise.white);
    const env = gainNode(ctx);
    pluckEnv(env.gain, t, 10 * amp, 0.001, 0.006);
    chain(src, env, filterNode(ctx, 'bandpass', f, 35), out);
    chain(env, filterNode(ctx, 'bandpass', f * 1.47, 45), out);
    src.start(t, Math.random() * 3);
    src.stop(t + 0.08);
  }
}
