import type { Manifest, ManifestStem } from '../data/manifest';

type Format = 'opus' | 'aac';

/** Ogg Opus where the browser says it can; otherwise (older Safari) straight to AAC. */
function preferredFormat(): Format {
  try {
    return document.createElement('audio').canPlayType('audio/ogg; codecs=opus') ? 'opus' : 'aac';
  } catch {
    return 'aac';
  }
}

/**
 * The composed stems listed in assets/manifest.json. Created when sound is first turned on, so
 * nothing is fetched until then (design doc §12); files then download one at a time, in priority
 * order, and are decoded only when a layer asks. If Opus fails to decode, every later stem is
 * fetched as AAC instead.
 */
export class StemLibrary {
  private readonly ctx: BaseAudioContext;
  private readonly base: URL;
  private readonly stems: Promise<Record<string, ManifestStem>>;
  private readonly bytes = new Map<string, Promise<ArrayBuffer>>();
  private readonly decoded = new Map<string, Promise<AudioBuffer>>();
  private queue: Promise<unknown> = Promise.resolve();
  format: Format = preferredFormat();
  /** Files that failed, for the status readout. */
  readonly failed: string[] = [];

  constructor(ctx: BaseAudioContext, base: URL) {
    this.ctx = ctx;
    this.base = base;
    this.stems = fetch(new URL('manifest.json', base))
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m) => m.stems ?? {})
      .catch((err: Error) => {
        console.warn(`audio: no stems (${err.message}); the synth layers play instead`);
        return {};
      });
  }

  /** The stem that replaces a layer, or null. */
  async forLayer(layer: ManifestStem['layer']): Promise<ManifestStem | null> {
    return Object.values(await this.stems).find((s) => s.layer === layer) ?? null;
  }

  /** Queue every file for download, highest priority first and first variants first. */
  async prefetch(): Promise<void> {
    const stems = Object.values(await this.stems).sort((a, b) => a.priority - b.priority);
    const rounds = Math.max(0, ...stems.map((s) => s.variants.length));
    for (let i = 0; i < rounds; i++) for (const s of stems) if (s.variants[i]) void this.fetch(s.variants[i][this.format].file).catch(() => undefined);
  }

  /** Variant i of a stem, decoded. Concurrent calls share one decode. */
  buffer(stem: ManifestStem, i: number): Promise<AudioBuffer> {
    const key = `${stem.layer}:${i}`;
    let p = this.decoded.get(key);
    if (!p) {
      p = this.decode(stem, i);
      this.decoded.set(key, p);
      p.catch(() => this.decoded.delete(key));
    }
    return p;
  }

  /** Forget a decoded variant; its compressed bytes stay cached. */
  release(stem: ManifestStem, i: number): void {
    this.decoded.delete(`${stem.layer}:${i}`);
  }

  private async decode(stem: ManifestStem, i: number): Promise<AudioBuffer> {
    const format = this.format;
    const file = stem.variants[i][format].file;
    try {
      // decodeAudioData detaches what it's given, so hand it a copy and keep the original.
      return await this.ctx.decodeAudioData((await this.fetch(file)).slice(0));
    } catch (err) {
      this.failed.push(file);
      if (format === 'opus') {
        this.format = 'aac';
        return this.decode(stem, i);
      }
      throw err;
    }
  }

  private fetch(file: string): Promise<ArrayBuffer> {
    let p = this.bytes.get(file);
    if (!p) {
      // One download at a time, in the order asked for.
      p = this.queue.then(async () => {
        const r = await fetch(new URL(file, this.base));
        if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      this.queue = p.catch(() => undefined);
      this.bytes.set(file, p);
      p.catch(() => this.bytes.delete(file));
    }
    return p;
  }
}
