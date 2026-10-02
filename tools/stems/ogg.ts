// Ogg Opus muxing (RFC 7845) for the packets WebCodecs' Opus encoder produces.

const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
  CRC[i] = r >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0;
  for (const b of bytes) c = ((c << 8) ^ CRC[((c >>> 24) ^ b) & 0xff]) >>> 0;
  return c;
}

const FLAG_BOS = 0x02;
const FLAG_EOS = 0x04;

/** One Ogg page holding whole packets. granule is -1 when no packet ends on the page (never here). */
function page(packets: Uint8Array[], serial: number, seq: number, granule: bigint, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    for (let n = p.length; ; n -= 255) {
      lacing.push(Math.min(n, 255));
      if (n < 255) break;
    }
  }
  if (lacing.length > 255) throw new Error('ogg: too many segments on one page');
  const body = packets.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + body);
  const v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53]); // "OggS"
  v.setUint8(4, 0);
  v.setUint8(5, flags);
  v.setBigInt64(6, granule, true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  v.setUint8(26, lacing.length);
  out.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const p of packets) {
    out.set(p, o);
    o += p.length;
  }
  v.setUint32(22, crc32(out), true);
  return out;
}

function opusHead(channels: number, preSkip: number, inputRate: number): Uint8Array {
  const h = new Uint8Array(19);
  const v = new DataView(h.buffer);
  h.set(new TextEncoder().encode('OpusHead'));
  v.setUint8(8, 1);
  v.setUint8(9, channels);
  v.setUint16(10, preSkip, true);
  v.setUint32(12, inputRate, true);
  v.setInt16(16, 0, true);
  v.setUint8(18, 0);
  return h;
}

function opusTags(vendor: string, comments: string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts = [enc.encode('OpusTags'), u32(enc.encode(vendor).length), enc.encode(vendor), u32(comments.length)];
  for (const c of comments) parts.push(u32(enc.encode(c).length), enc.encode(c));
  return concat(parts);
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface OpusStream {
  channels: number;
  /** Encoder delay in 48 kHz samples, from the encoder's OpusHead. */
  preSkip: number;
  inputRate: number;
  /** 20 ms packets in order. */
  packets: Uint8Array[];
  /** Samples of real audio (48 kHz); the end of the last packet beyond this is trimmed by the decoder. */
  length: number;
  comments: string[];
}

const FRAME = 960; // 20 ms at 48 kHz
const PER_PAGE = 50; // about one second of audio per page

/** Mux Opus packets into an Ogg file. The last page's granule trims the encoder's end padding. */
export function muxOggOpus(s: OpusStream, serial: number): Uint8Array {
  const pages = [
    page([opusHead(s.channels, s.preSkip, s.inputRate)], serial, 0, 0n, FLAG_BOS),
    page([opusTags('hollowmere tools/stems.ts', s.comments)], serial, 1, 0n, 0),
  ];
  const end = BigInt(s.preSkip + s.length);
  for (let i = 0, seq = 2; i < s.packets.length; i += PER_PAGE, seq++) {
    const chunk = s.packets.slice(i, i + PER_PAGE);
    const last = i + PER_PAGE >= s.packets.length;
    const granule = last ? end : BigInt((i + chunk.length) * FRAME);
    pages.push(page(chunk, serial, seq, granule < end ? granule : end, last ? FLAG_EOS : 0));
  }
  return concat(pages);
}
