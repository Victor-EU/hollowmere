import { chain, gainNode } from './nodes';

export interface Reverb {
  /** Sum of every send. */
  input: GainNode;
  /** Wet return; connect to the bus. */
  output: GainNode;
}

/** The one shared convolution reverb. Its impulse is decaying stereo noise, generated (mockup: 4.5 s, wet 0.6). */
export function createReverb(ctx: BaseAudioContext, seconds = 4.5, wet = 0.6): Reverb {
  const input = gainNode(ctx, 1);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, seconds);
  const output = gainNode(ctx, wet);
  chain(input, conv, output);
  return { input, output };
}

function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}
