// The composed stems the game ships, shared by tools/stems.ts (Node) and the render page (browser).

export interface StemSpec {
  id: string;
  /** The mix layer the stem replaces (src/audio/mix.ts). */
  layer: 'musicbox' | 'choir';
  /** Loop variants; [''] for a single loop. Files are <id>-<variant> or just <id>. */
  variants: string[];
  /** Mono bitrates. Mono at 64 kbps Opus is about what the design's 96–128 kbps buys in stereo. */
  bitrate: { opus: number; aac: number };
  /** Fetch order once sound is on, lowest first. */
  priority: number;
  /** dB on top of the loudness match with the synth layer. */
  trim: number;
}

export const STEMS: StemSpec[] = [
  { id: 'musicbox', layer: 'musicbox', variants: ['a', 'b', 'c'], bitrate: { opus: 64000, aac: 80000 }, priority: 0, trim: 0 },
  { id: 'choir', layer: 'choir', variants: [''], bitrate: { opus: 64000, aac: 80000 }, priority: 1, trim: 0 },
];

export const SAMPLE_RATE = 48000;
/** Seconds of the loop's own end before it and its own start after it, so decoder delay can't put a seam in. */
export const PAD = 1;

export const fileName = (id: string, variant: string): string => (variant ? `${id}-${variant}` : id);

// What the page hands back for each stem.
export interface RenderedVariant {
  variant: string;
  /** Base64 Ogg Opus and ADTS AAC. */
  opus: string;
  aac: string;
  /** Gated loudness, dB full scale. */
  loudness: number;
  peak: number;
  /**
   * How far the loop is from repeating exactly, dB below its loudness: in the render (what spills
   * past the end, or the difference between two cycles) and after each codec round trip.
   */
  seam: { render: number; opus: number; aac: number };
  /** PNG data URL of a spectrogram, when asked for. */
  spectrogram?: string;
}

export interface Rendered {
  loopLength: number;
  /** Gated loudness of the synth layer this replaces, dB. */
  reference: number;
  variants: RenderedVariant[];
}
