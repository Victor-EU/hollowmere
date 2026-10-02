// The two instruments the stand-in stems are played on, rendered offline with Web Audio (in the
// browser page that tools/stems.ts drives). Both render dry and mono: the game's shared reverb
// gives them their room, exactly as it does the synth layers they replace.

import { mtof } from '../../src/audio/math.ts';
import { CHOIR, CHOIR_LEVELS, CHOIR_VOWELS, CHORD, CYCLE, PARTS, type Note, type Part } from './score.ts';

/** Small seeded PRNG (mulberry32), so a render is the same every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = seeded(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return buf;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number, gain = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.gain.value = gain;
  return f;
}

// ---------------------------------------------------------------------------------------------
// Music box: a steel comb plucked by pins, in a small wooden box.

/** [frequency ratio, amplitude, share of the fundamental's ring time] */
const TINE: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [1.0018, 0.22, 0.8], // a slightly sharp twin: the slow shimmer of a worn comb (about 1 Hz at D5)
  [2, 0.05, 0.45],
  [3.01, 0.025, 0.3],
  [6.27, 0.14, 0.12], // the tine's second bending mode: the metallic "ting"
  [17.55, 0.04, 0.03],
];

function tine(ctx: BaseAudioContext, out: AudioNode, click: AudioBuffer, [at, midi, vel]: Note, r: () => number): void {
  const t = Math.max(0, at + (r() - 0.5) * 0.024);
  const f = mtof(midi) * (1 + (r() - 0.5) * 0.0016);
  // Low teeth ring longer; seconds to fall about 60 dB.
  const ring = Math.min(6, Math.max(1.6, 4.2 * Math.pow(440 / f, 0.6)));
  const peak = 0.22 * Math.pow(vel, 1.4);
  for (const [ratio, amp, share] of TINE) {
    if (f * ratio > ctx.sampleRate * 0.45) continue;
    const bright = ratio > 4 ? 0.5 + vel : 1;
    const o = ctx.createOscillator();
    o.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * amp * bright, t + 0.0015);
    g.gain.setTargetAtTime(0, t + 0.0015, (ring * share) / 6.9);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + ring * share + 0.05);
  }
  // The pin leaving the tooth.
  const src = ctx.createBufferSource();
  src.buffer = click;
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05 * vel, t + 0.0005);
  g.gain.setTargetAtTime(0, t + 0.0005, 0.0015);
  src.connect(filter(ctx, 'bandpass', 3500, 0.8)).connect(g).connect(out);
  src.start(t, r() * 0.5);
  src.stop(t + 0.03);
}

/** One music-box variant, `seconds` long, mono. */
export async function renderMusicBox(notes: readonly Note[], seconds: number, sampleRate: number, seed: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  // The box: no deep bass, a woody bump and a little presence, then a few milliseconds of its own walls.
  const body = ctx.createGain();
  const out = ctx.createGain();
  body
    .connect(filter(ctx, 'highpass', 140, 0))
    .connect(filter(ctx, 'peaking', 420, 1.4, 3))
    .connect(filter(ctx, 'peaking', 1900, 1, 2))
    .connect(out);
  const box = ctx.createConvolver();
  box.buffer = smallRoom(ctx, 0.05, seed + 1);
  const boxSend = ctx.createGain();
  boxSend.gain.value = 0.25;
  out.connect(ctx.destination);
  out.connect(box).connect(boxSend).connect(ctx.destination);

  const click = noiseBuffer(ctx, 1, seed + 2);
  const r = seeded(seed);
  for (const n of notes) tine(ctx, body, click, n, r);
  return (await ctx.startRendering()).getChannelData(0);
}

function smallRoom(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buf = noiseBuffer(ctx, seconds, seed);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] *= Math.pow(1 - i / d.length, 3) * 0.6;
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Choir: four parts of three singers each, on "ah" and "oh".

/** [centre Hz, level dB, bandwidth Hz] for five formants (the usual sung-vowel tables). */
type Formants = readonly (readonly [number, number, number])[];
const FORMANTS: Record<Part, Record<'a' | 'o', Formants>> = {
  bass: {
    a: [[600, 0, 60], [1040, -7, 70], [2250, -9, 110], [2450, -9, 120], [2750, -20, 130]],
    o: [[400, 0, 40], [750, -11, 80], [2400, -21, 100], [2600, -20, 120], [2900, -40, 120]],
  },
  tenor: {
    a: [[650, 0, 80], [1080, -6, 90], [2650, -7, 120], [2900, -8, 130], [3250, -22, 140]],
    o: [[400, 0, 40], [800, -10, 80], [2600, -12, 100], [2800, -12, 120], [3000, -26, 120]],
  },
  alto: {
    a: [[800, 0, 80], [1150, -4, 90], [2800, -20, 120], [3500, -36, 130], [4950, -60, 140]],
    o: [[450, 0, 70], [800, -9, 80], [2830, -16, 100], [3500, -28, 130], [4950, -55, 135]],
  },
  soprano: {
    a: [[800, 0, 80], [1150, -6, 90], [2900, -32, 120], [3900, -20, 130], [4950, -50, 140]],
    o: [[450, 0, 70], [800, -11, 80], [2830, -22, 100], [3800, -22, 130], [4950, -50, 135]],
  },
};

const PART_LEVEL: Record<Part, number> = { bass: 0.6, tenor: 0.75, alto: 0.85, soprano: 0.7 };
const SINGERS = 3;

/** One sung period for a part, vowel and pitch: harmonics weighted by the vowel's formants. RMS 0.3. */
function voiceWave(ctx: BaseAudioContext, part: Part, vowel: 'a' | 'o', f0: number): PeriodicWave {
  const n = Math.min(40, Math.floor(7000 / f0));
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  const r = seeded(hash(part, vowel, f0.toFixed(2)));
  let power = 0;
  for (let k = 1; k <= n; k++) {
    const h = k * f0;
    let a = 0.0008;
    // Bandwidths doubled: a section blurs the formants that one voice would show.
    for (const [F, dB, B] of FORMANTS[part][vowel]) a += Math.pow(10, dB / 20) / Math.sqrt(1 + ((h - F) / B) ** 2);
    a /= k;
    const phase = r() * Math.PI * 2;
    real[k] = a * Math.cos(phase);
    imag[k] = a * Math.sin(phase);
    power += (a * a) / 2;
  }
  const k = 0.3 / Math.sqrt(power);
  for (let i = 1; i <= n; i++) {
    real[i] *= k;
    imag[i] *= k;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

interface Sung {
  part: Part;
  start: number;
  end: number;
  midi: number;
  vowel: 'a' | 'o';
  /** Start within the cycle, which seeds the singers so every cycle sounds the same. */
  key: number;
}

/** Each part's notes over `cycles` repeats, holding a pitch across the cycle boundary when it repeats. */
function sungNotes(cycles: number): Sung[] {
  const out: Sung[] = [];
  for (const part of PARTS) {
    const line = CHOIR[part];
    const all: { at: number; midi: number; key: number }[] = [];
    for (let c = 0; c < cycles; c++) {
      for (const [at, midi] of line) {
        if (all.at(-1)?.midi === midi) continue;
        all.push({ at: at + c * CYCLE, midi, key: at });
      }
    }
    all.forEach((e, i) => {
      const end = i + 1 < all.length ? all[i + 1].at : cycles * CYCLE;
      const vowel = CHOIR_VOWELS[Math.floor(e.key / CHORD) % CHOIR_VOWELS.length];
      out.push({ part, start: e.at, end, midi: e.midi, vowel, key: e.key });
    });
  }
  return out;
}

function singer(ctx: BaseAudioContext, out: AudioNode, wave: PeriodicWave, n: Sung, v: number, level: number): void {
  const r = seeded(hash(n.part, v, n.key, n.midi));
  // Each singer leans a fixed way off pitch, and enters and leaves at their own moment.
  const lean = (seeded(hash(n.part, v))() - 0.5) * 14;
  const on = Math.max(0, n.start - 0.25 - r() * 0.5);
  const off = n.end + 0.2 + r() * 0.4;
  const stop = off + 3;

  const o = ctx.createOscillator();
  o.setPeriodicWave(wave);
  o.frequency.value = mtof(n.midi);
  o.detune.value = lean + (r() - 0.5) * 4;
  // Vibrato that blooms after the onset, and a slow wander.
  const vib = ctx.createOscillator();
  vib.frequency.value = 4.8 + r();
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, on);
  depth.gain.setValueAtTime(0, on + 0.6);
  depth.gain.linearRampToValueAtTime(12 + r() * 10, on + 2.1);
  vib.connect(depth).connect(o.detune);
  const wander = ctx.createOscillator();
  wander.frequency.value = 0.13 + r() * 0.25;
  const wanderDepth = ctx.createGain();
  wanderDepth.gain.value = 4;
  wander.connect(wanderDepth).connect(o.detune);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, on);
  env.gain.setTargetAtTime(level, on, 0.5 + r() * 0.4);
  env.gain.setTargetAtTime(0, off, 0.45);
  // Breath: the level sways a little.
  const sway = ctx.createGain();
  sway.gain.value = 1;
  const swayLfo = ctx.createOscillator();
  swayLfo.frequency.value = 0.2 + r() * 0.3;
  const swayDepth = ctx.createGain();
  swayDepth.gain.value = 0.12;
  swayLfo.connect(swayDepth).connect(sway.gain);

  o.connect(env).connect(sway).connect(out);
  for (const s of [o, vib, wander, swayLfo]) {
    s.start(on);
    s.stop(stop);
  }
}

/**
 * The choir over `cycles` repeats of the score, `seconds` long, mono. Everything inside a cycle is
 * seeded by its position in the cycle, so from the second cycle on the render repeats exactly.
 */
export async function renderChoir(cycles: number, seconds: number, sampleRate: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const dyn = ctx.createGain();
  // Heard across a hall, not up close: no rumble, and the top softened.
  dyn.connect(filter(ctx, 'highpass', 70, 0)).connect(filter(ctx, 'lowpass', 4500, 0)).connect(ctx.destination);
  // The phrase shape: each chord swells through its middle.
  dyn.gain.setValueAtTime(CHOIR_LEVELS[0] * 0.82, 0);
  for (let c = 0; c < cycles; c++) {
    CHOIR_LEVELS.forEach((L, i) => {
      const t = c * CYCLE + i * CHORD;
      dyn.gain.linearRampToValueAtTime(L * 0.82, t + 0.5);
      dyn.gain.linearRampToValueAtTime(L, t + 6);
      dyn.gain.linearRampToValueAtTime(L * 0.88, t + 11.5);
    });
  }

  const waves = new Map<string, PeriodicWave>();
  for (const n of sungNotes(cycles)) {
    const id = `${n.part}${n.vowel}${n.midi}`;
    if (!waves.has(id)) waves.set(id, voiceWave(ctx, n.part, n.vowel, mtof(n.midi)));
    for (let v = 0; v < SINGERS; v++) singer(ctx, dyn, waves.get(id)!, n, v, (PART_LEVEL[n.part] / SINGERS) * 1.4);
  }

  // Breath noise through the open-vowel formants, one seeded burst per chord.
  const breath = ctx.createGain();
  breath.gain.value = 0.012;
  breath.connect(dyn);
  const bands = [filter(ctx, 'bandpass', 800, 1.5), filter(ctx, 'bandpass', 1150, 2), filter(ctx, 'bandpass', 2800, 3)];
  for (const b of bands) b.connect(breath);
  const puffs = CHOIR_LEVELS.map((_, i) => noiseBuffer(ctx, CHORD + 1, hash('breath', i)));
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < CHOIR_LEVELS.length; i++) {
      const t = c * CYCLE + i * CHORD;
      const src = ctx.createBufferSource();
      src.buffer = puffs[i];
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 1);
      env.gain.setValueAtTime(1, t + CHORD - 0.5);
      env.gain.linearRampToValueAtTime(0, t + CHORD + 0.5);
      src.connect(env);
      for (const b of bands) env.connect(b);
      src.start(t);
      src.stop(t + CHORD + 0.6);
    }
  }
  return (await ctx.startRendering()).getChannelData(0);
}
