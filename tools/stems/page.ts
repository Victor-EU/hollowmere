// Browser side of tools/stems.ts: render a stem offline, wrap it for seamless looping, encode it
// to Opus and AAC with WebCodecs, and check the decoded files still loop.

import { Choir } from '../../src/audio/layers/choir.ts';
import type { Layer } from '../../src/audio/layers/layer.ts';
import { MusicBox } from '../../src/audio/layers/musicbox.ts';
import { createNoiseBank } from '../../src/audio/noise.ts';
import { renderChoir, renderMusicBox, seeded } from './instruments.ts';
import { muxOggOpus } from './ogg.ts';
import { CHORD, CYCLE, MUSIC_BOX } from './score.ts';
import { PAD, SAMPLE_RATE as SR, STEMS, type Rendered, type RenderedVariant, type StemSpec } from './specs.ts';

declare global {
  interface Window {
    stems: { render(id: string, masters: Record<string, string>, report: boolean): Promise<Rendered> };
  }
}

/** The loop itself (exactly `length` samples, wrapping onto itself) and how cleanly it wraps. */
interface Loop {
  pcm: Float32Array;
  /** Largest sample by which the source fails to repeat at the wrap. */
  error: number;
}

async function renderLoop(spec: StemSpec, variant: string, master: string | undefined): Promise<Loop> {
  if (master) return decodeMaster(master);
  const L = CYCLE * SR;
  if (spec.id === 'musicbox') {
    // Everything has died away by the end of the cycle, so the loop is just the cycle.
    const all = await renderMusicBox(MUSIC_BOX[variant], CYCLE + 6, SR, variant.charCodeAt(0));
    return { pcm: all.slice(0, L), error: peak(all.subarray(L)) };
  }
  // Render three cycles and keep the middle one, whose start already carries the tails of the
  // cycle before; the third cycle checks that the render really repeats.
  const all = await renderChoir(3, 2 * CYCLE + 2, SR);
  let error = 0;
  for (let i = 0; i < SR * 2; i++) error = Math.max(error, Math.abs(all[2 * L + i] - all[L + i]));
  return { pcm: all.slice(L, 2 * L), error };
}

/** A composer's master, decoded at 48 kHz and folded to mono. The whole file is the loop. */
async function decodeMaster(url: string): Promise<Loop> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const buf = await new OfflineAudioContext(1, 1, SR).decodeAudioData(bytes);
  const pcm = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) pcm[i] += d[i] / buf.numberOfChannels;
  }
  return { pcm, error: Math.abs(pcm[0] - pcm[pcm.length - 1]) };
}

/** [last PAD s of the loop][the loop][first PAD s of the loop]: periodic all the way through. */
function wrap(loop: Float32Array): Float32Array {
  const p = PAD * SR;
  const out = new Float32Array(loop.length + 2 * p);
  out.set(loop.subarray(loop.length - p), 0);
  out.set(loop, p);
  out.set(loop.subarray(0, p), p + loop.length);
  return out;
}

async function encode(codec: 'opus' | 'aac', pcm: Float32Array, bitrate: number): Promise<Uint8Array> {
  const packets: Uint8Array[] = [];
  let preSkip = 312;
  let failure: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const b = new Uint8Array(chunk.byteLength);
      chunk.copyTo(b);
      packets.push(b);
      const desc = meta?.decoderConfig?.description;
      if (codec === 'opus' && desc) {
        const head = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc);
        preSkip = head[10] | (head[11] << 8);
      }
    },
    error: (e) => (failure = e),
  });
  enc.configure(
    codec === 'opus'
      ? { codec: 'opus', sampleRate: SR, numberOfChannels: 1, bitrate, opus: { complexity: 10, frameDuration: 20000 } }
      : { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 1, bitrate, aac: { format: 'adts' } },
  );
  const step = SR / 10;
  for (let i = 0; i < pcm.length; i += step) {
    const data = pcm.slice(i, Math.min(pcm.length, i + step));
    enc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: data.length, numberOfChannels: 1, timestamp: Math.round((i / SR) * 1e6), data }));
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  if (codec === 'aac') return concat(packets);
  return muxOggOpus({ channels: 1, preSkip, inputRate: SR, packets, length: pcm.length, comments: ['ENCODER=WebCodecs'] }, 0x484d5354);
}

/**
 * Decode an encoded file and compare the audio around loopEnd with the audio around loopStart
 * (PAD and PAD + loop length), which a perfectly periodic file would make identical. A codec with
 * frame-to-frame state (Opus) never quite repeats, which is why the player crossfades at the loop
 * point rather than jumping.
 */
async function seamAfterCodec(bytes: Uint8Array, loopSamples: number, loud: number): Promise<number> {
  const buf = await new OfflineAudioContext(1, 1, SR).decodeAudioData(bytes.slice().buffer);
  const d = buf.getChannelData(0);
  const s = PAD * SR;
  const e = s + loopSamples;
  if (d.length < e + SR / 10) throw new Error(`decoded only ${d.length} samples, need ${e + SR / 10}`);
  let err = 0;
  for (let i = -SR / 20; i < SR / 20; i++) err += (d[s + i] - d[e + i]) ** 2;
  return relDb(Math.sqrt(err / (SR / 10)), loud);
}

/** BS.1770-style gated loudness, without the K-weighting: 400 ms blocks, absolute and relative gates. */
function loudness(x: Float32Array): number {
  const w = Math.round(0.4 * SR);
  const hop = Math.round(0.1 * SR);
  const blocks: number[] = [];
  for (let i = 0; i + w <= x.length; i += hop) {
    let p = 0;
    for (let k = i; k < i + w; k++) p += x[k] * x[k];
    blocks.push(p / w);
  }
  const gated = blocks.filter((p) => p > 1e-7);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const rel = mean(gated) * 0.1;
  return 10 * Math.log10(mean(gated.filter((p) => p > rel)) || 1e-12);
}

const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const relDb = (amp: number, loudDb: number) => Math.round((20 * Math.log10(Math.max(amp, 1e-9)) - loudDb) * 10) / 10;

/** Loudness of the synth layer a stem replaces, over two cycles, with Math.random seeded so it's repeatable. */
async function reference(layer: StemSpec['layer']): Promise<number> {
  const seconds = 2 * CYCLE;
  const random = Math.random;
  Math.random = seeded(7);
  try {
    const ctx = new OfflineAudioContext(1, seconds * SR, SR);
    const noise = createNoiseBank(ctx);
    const l: Layer = layer === 'musicbox' ? new MusicBox(ctx, noise, 0.35) : new Choir(ctx, noise, 0.35);
    l.output.connect(ctx.destination);
    l.start(0);
    l.schedule(0, seconds);
    return loudness((await ctx.startRendering()).getChannelData(0));
  } finally {
    Math.random = random;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// --- Spectrogram, for looking at what was rendered -------------------------------------------

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Log-frequency spectrogram (55 Hz–9 kHz, 60 dB), with a line at every chord change and a tick at every D. */
function spectrogram(x: Float32Array): string {
  const W = 1536;
  const H = 480;
  const N = 8192;
  const lo = Math.log2(55);
  const hi = Math.log2(9000);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const cols: Float64Array[] = [];
  let top = 1e-12;
  for (let c = 0; c < W; c++) {
    const at = Math.floor((c / W) * (x.length - N));
    for (let i = 0; i < N; i++) {
      re[i] = x[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft(re, im);
    const col = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      const f = 2 ** (hi - ((hi - lo) * y) / H);
      const k = Math.round((f / SR) * N);
      col[y] = Math.hypot(re[k], im[k]);
      top = Math.max(top, col[y]);
    }
    cols.push(col);
  }
  for (let c = 0; c < W; c++) {
    for (let y = 0; y < H; y++) {
      const db = 20 * Math.log10(cols[c][y] / top + 1e-12);
      const v = Math.max(0, Math.min(1, (db + 60) / 60));
      const i = (y * W + c) * 4;
      img.data[i] = 255 * Math.min(1, v * 1.6);
      img.data[i + 1] = 255 * Math.max(0, v * 1.6 - 0.55);
      img.data[i + 2] = 255 * Math.max(0, 0.35 - v) * 1.5 + 255 * Math.max(0, v - 0.85) * 4;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(120,200,255,0.45)';
  const seconds = x.length / SR;
  for (let t = 0; t <= seconds; t += CHORD) {
    const px = (t / seconds) * W;
    g.beginPath();
    g.moveTo(px, 0);
    g.lineTo(px, H);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = '11px sans-serif';
  for (let oct = 1; oct <= 8; oct++) {
    const f = 440 * 2 ** ((14 + 12 * oct - 69) / 12); // D in each octave
    const y = ((hi - Math.log2(f)) / (hi - lo)) * H;
    if (y < 0 || y > H) continue;
    g.fillRect(0, y, 8, 1);
    g.fillText(`D${oct}`, 10, y + 4);
  }
  return cv.toDataURL('image/png');
}

/** Loops are scaled together to peak here, so the encoders never see a sample past full scale. */
const HEADROOM = 0.89;

window.stems = {
  async render(id, masters, report) {
    const spec = STEMS.find((s) => s.id === id);
    if (!spec) throw new Error(`no stem "${id}"`);
    const loops: Loop[] = [];
    for (const variant of spec.variants) loops.push(await renderLoop(spec, variant, masters[variant]));
    const length = loops[0].pcm.length;
    if (loops.some((l) => l.pcm.length !== length)) throw new Error(`${id}: variants differ in length`);
    // One scale for every variant, so they keep their levels relative to each other.
    const scale = HEADROOM / Math.max(...loops.map((l) => peak(l.pcm)));
    const variants: RenderedVariant[] = [];
    for (const [i, loop] of loops.entries()) {
      for (let k = 0; k < length; k++) loop.pcm[k] *= scale;
      const wrapped = wrap(loop.pcm);
      const loud = loudness(loop.pcm);
      const opus = await encode('opus', wrapped, spec.bitrate.opus);
      const aac = await encode('aac', wrapped, spec.bitrate.aac);
      variants.push({
        variant: spec.variants[i],
        opus: base64(opus),
        aac: base64(aac),
        loudness: Math.round(loud * 10) / 10,
        peak: Math.round(peak(loop.pcm) * 1000) / 1000,
        seam: {
          render: relDb(loop.error * scale, loud),
          opus: await seamAfterCodec(opus, length, loud),
          aac: await seamAfterCodec(aac, length, loud),
        },
        spectrogram: report ? spectrogram(loop.pcm) : undefined,
      });
    }
    return { loopLength: length / SR, reference: Math.round((await reference(spec.layer)) * 10) / 10, variants };
  },
};
