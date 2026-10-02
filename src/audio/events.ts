import { chain, filterNode, gainNode } from './nodes';
import type { NoiseBank } from './noise';
import type { AudioEventType, ListenerState } from './types';
import { Kit, SYNTHS } from './voices';
import type { Point3 } from './zones';

interface Spec {
  /** Full level within this distance (m). */
  ref: number;
  /** Silent beyond this distance (m). */
  max: number;
  level: number;
  /** Reverb send at the listener; distance adds more. */
  wet: number;
  /** Concurrent voices of this type. */
  limit: number;
  /** Minimum seconds between triggers. */
  gap: number;
}

const SPECS: Record<AudioEventType, Spec> = {
  roar: { ref: 70, max: 380, level: 1, wet: 0.7, limit: 1, gap: 1 },
  whoosh: { ref: 4, max: 60, level: 1, wet: 1, limit: 2, gap: 0.2 },
  caw: { ref: 10, max: 160, level: 0.25, wet: 0.5, limit: 3, gap: 0.15 },
  wingbeat: { ref: 12, max: 90, level: 0.12, wet: 0.3, limit: 2, gap: 0.3 },
  sigh: { ref: 4, max: 45, level: 0.17, wet: 0.6, limit: 2, gap: 0.5 },
  chitter: { ref: 4, max: 30, level: 0.08, wet: 0.4, limit: 2, gap: 0.25 },
  grind: { ref: 6, max: 70, level: 0.18, wet: 0.3, limit: 2, gap: 0.4 },
  creak: { ref: 8, max: 90, level: 0.17, wet: 0.4, limit: 2, gap: 0.4 },
};
const MAX_VOICES = 8;

export interface Placement {
  gain: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  /** 1 straight ahead, -1 straight behind. */
  front: number;
}

/** gain = ref / max(ref, distance), cut beyond max; pan from the listener's yaw. Null when out of range. */
export function place(at: Point3 | undefined, l: ListenerState, ref: number, max: number): Placement | null {
  if (!at) return { gain: 1, pan: 0, front: 1 };
  const dx = at.x - l.position.x;
  const dy = at.y - l.position.y;
  const dz = at.z - l.position.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > max) return null;
  const gain = ref / Math.max(ref, dist);
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-3) return { gain, pan: 0, front: 1 };
  const sin = Math.sin(l.yaw);
  const cos = Math.cos(l.yaw);
  const side = (dx * cos - dz * sin) / flat; // · right (cos, 0, -sin)
  const front = -(dx * sin + dz * cos) / flat; // · forward (-sin, 0, -cos)
  return { gain, pan: side * Math.min(1, flat / 3), front }; // sources nearly on top of us stay centred
}

/** One-shots: positioned, voice-limited, each through its own air filter, equal-power panner and reverb send. */
export class EventPlayer {
  private readonly ctx: BaseAudioContext;
  private readonly dry: AudioNode;
  private readonly wet: AudioNode;
  private readonly noise: NoiseBank;
  private active: { type: AudioEventType; end: number }[] = [];
  private readonly last = new Map<AudioEventType, number>();

  constructor(ctx: BaseAudioContext, dry: AudioNode, wet: AudioNode, noise: NoiseBank) {
    this.ctx = ctx;
    this.dry = dry;
    this.wet = wet;
    this.noise = noise;
  }

  play(type: AudioEventType, at: Point3 | undefined, listener: ListenerState): void {
    const spec = SPECS[type];
    const p = place(at, listener, spec.ref, spec.max);
    if (!p || p.gain * spec.level < 0.003) return;
    const now = this.ctx.currentTime;
    this.active = this.active.filter((v) => v.end > now);
    if (this.active.length >= MAX_VOICES) return;
    if (this.active.filter((v) => v.type === type).length >= spec.limit) return;
    if (now - (this.last.get(type) ?? -Infinity) < spec.gap) return;
    this.last.set(type, now);

    // Distance darkens and wets the sound; sources behind are a little duller.
    const cutoff = Math.max(1200, 18000 * Math.pow(p.gain, 0.6) * (1 - 0.3 * Math.max(0, -p.front)));
    const input = gainNode(this.ctx, spec.level * p.gain);
    const air = filterNode(this.ctx, 'lowpass', cutoff, -3);
    const panner = this.ctx.createStereoPanner(); // equal-power for mono sources
    panner.pan.value = p.pan;
    const send = gainNode(this.ctx, Math.min(1.5, spec.wet + 0.5 * (1 - p.gain)));
    chain(input, air, panner, this.dry);
    chain(panner, send, this.wet);

    const kit = new Kit(this.ctx, input, now + 0.02, this.noise, panner.pan, p.pan);
    SYNTHS[type](kit);
    this.active.push({ type, end: kit.end });
    if (kit.last) {
      kit.last.onended = () => {
        for (const n of [input, air, panner, send]) n.disconnect();
      };
    }
  }
}
