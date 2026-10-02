// Node factories and envelopes shared by layers and one-shots.
// Note: for lowpass/highpass the Web Audio Q is a resonance in dB; for bandpass it is the usual linear Q.

export function gainNode(ctx: BaseAudioContext, value = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function filterNode(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q !== undefined) f.Q.value = q;
  return f;
}

export function oscNode(ctx: BaseAudioContext, type: OscillatorType, freq: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  return o;
}

export function loopNode(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  return s;
}

export function chain(...nodes: AudioNode[]): void {
  for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
}

/** Linear attack to `peak`, then an exponential fall with time constant `tau`. */
export function pluckEnv(param: AudioParam, t: number, peak: number, attack: number, tau: number): void {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, tau);
}

/** Linear attack to `peak`, then an exponential ramp to near silence at `t + dur` (the mockup's envelope). */
export function fallEnv(param: AudioParam, t: number, peak: number, attack: number, dur: number, floor = 0.0005): void {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(Math.min(floor, peak * 0.1), t + dur);
}

/** [frequency ratio, relative amplitude, seconds to fade] */
export type Overtone = readonly [ratio: number, amp: number, dur: number];

/** Struck sine partials, each falling over its own duration: the bell and the high notes. */
export function strike(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, peak: number, partials: readonly Overtone[], attack = 0.01): void {
  for (const [ratio, amp, dur] of partials) {
    const o = oscNode(ctx, 'sine', freq * ratio);
    const g = gainNode(ctx);
    fallEnv(g.gain, t, peak * amp, attack, dur);
    chain(o, g, out);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
}
