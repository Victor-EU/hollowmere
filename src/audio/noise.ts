/** Looping noise buffers, generated once per context and shared by every layer and one-shot. */
export interface NoiseBank {
  /** Uniform white noise, unscaled (as in the mockup). */
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  /** Sparse clicks and pops for the gate's fire. */
  crackle: AudioBuffer;
}

type Color = 'white' | 'pink' | 'brown';

export function createNoiseBank(ctx: BaseAudioContext): NoiseBank {
  return {
    white: noise(ctx, 'white', 4),
    pink: noise(ctx, 'pink', 5),
    brown: noise(ctx, 'brown', 5),
    crackle: crackle(ctx, 7.3),
  };
}

function noise(ctx: BaseAudioContext, color: Color, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const fade = Math.floor(sr * 0.05);
  const raw = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'white') {
      raw[i] = w;
    } else if (color === 'pink') {
      // Paul Kellet's refined pink filter.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      b0 = (b0 + 0.02 * w) / 1.02;
      raw[i] = b0;
    }
  }

  const buf = ctx.createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  out.set(raw.subarray(0, n));
  // Equal-power crossfade of the overhang into the start, so the loop point has no seam.
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    out[i] = raw[i] * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a);
  }
  if (color !== 'white') {
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    const k = 0.9 / peak;
    for (let i = 0; i < n; i++) out[i] *= k;
  }
  return buf;
}

function crackle(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const tail = Math.floor(sr * 0.02);
  let i = Math.floor(sr * 0.01);
  while (i < n - tail) {
    const pop = Math.random() < 0.1;
    const amp = pop ? 0.5 + 0.4 * Math.random() : 0.06 + 0.5 * Math.random() ** 3;
    const len = Math.floor(sr * (pop ? 0.004 + 0.008 * Math.random() : 0.0004 + 0.0025 * Math.random()));
    let y = 0;
    for (let k = 0; k < len; k++) {
      const w = Math.random() * 2 - 1;
      y = pop ? y + 0.3 * (w - y) : w; // pops are duller than clicks
      d[i + k] += amp * Math.exp((-5 * k) / len) * y;
    }
    // Mostly a sparse scatter (about 7/s), sometimes a quick cluster.
    const gap = Math.random() < 0.2 ? 0.006 + 0.03 * Math.random() : -Math.log(1 - Math.random()) / 7;
    i += Math.max(len, Math.floor(sr * gap));
  }
  return buf;
}
