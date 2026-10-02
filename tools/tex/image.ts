// Float images for the texture tools: linear colour or height in metres, with wrap-around
// filtering so tileable maps stay tileable.

import sharp from 'sharp';

export interface Img {
  w: number;
  h: number;
  /** Channels per pixel. */
  c: number;
  d: Float32Array;
}

export const makeImg = (w: number, h: number, c = 1): Img => ({ w, h, c, d: new Float32Array(w * h * c) });

export const srgbToLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (x: number) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);

/** '#rrggbb' to linear RGB. */
export function hex(s: string): [number, number, number] {
  const n = parseInt(s.replace('#', ''), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

/** Box blur along one axis, wrapping. Three passes approximate a gaussian. */
function boxPass(src: Img, r: number, horizontal: boolean, wrap: boolean): Img {
  const { w, h, c } = src;
  const out = makeImg(w, h, c);
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? c : w * c;
  const line = new Float32Array(n);
  const k = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * c : l * c;
    for (let ch = 0; ch < c; ch++) {
      for (let i = 0; i < n; i++) line[i] = src.d[base + i * step + ch];
      const at = (i: number) => (wrap ? line[((i % n) + n) % n] : line[i < 0 ? 0 : i >= n ? n - 1 : i]);
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += at(i);
      for (let i = 0; i < n; i++) {
        out.d[base + i * step + ch] = acc * k;
        acc += at(i + r + 1) - at(i - r);
      }
    }
  }
  return out;
}

export function blur(src: Img, radius: number, wrap = true): Img {
  const r = Math.max(1, Math.round(radius / Math.sqrt(3)));
  let img = src;
  for (let p = 0; p < 3; p++) img = boxPass(boxPass(img, r, true, wrap), r, false, wrap);
  return img;
}

/**
 * Tangent-space normal map from a height map in metres. `pixel` is the size of a texel in metres.
 * Green points up the image (+v), which is three.js's convention once the KTX2 is Y-flipped.
 */
export function normalFromHeight(height: Img, pixel: number, strength = 1, wrap = true): Img {
  const { w, h } = height;
  const out = makeImg(w, h, 3);
  const at = (x: number, y: number) => {
    if (wrap) return height.d[((y + h) % h) * w + ((x + w) % w)];
    return height.d[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  };
  const k = strength / (8 * pixel);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel: +x to the right, +v up the image (row - 1).
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const du = (tr + 2 * r + br - tl - 2 * l - bl) * k;
      const dv = (tl + 2 * t + tr - bl - 2 * b - br) * k;
      const inv = 1 / Math.hypot(du, dv, 1);
      const i = (y * w + x) * 3;
      out.d[i] = -du * inv * 0.5 + 0.5;
      out.d[i + 1] = -dv * inv * 0.5 + 0.5;
      out.d[i + 2] = inv * 0.5 + 0.5;
    }
  }
  return out;
}

/** Halve the size with a wrapping tent filter (good enough for power-of-two tiers). */
export function halve(src: Img, wrap = true): Img {
  const { w, h, c } = src;
  const W = w >> 1;
  const H = h >> 1;
  const out = makeImg(W, H, c);
  const wt = [0.125, 0.375, 0.375, 0.125];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < c; ch++) {
        let acc = 0;
        for (let j = 0; j < 4; j++) {
          let sy = 2 * y - 1 + j;
          sy = wrap ? (sy + h) % h : Math.min(h - 1, Math.max(0, sy));
          for (let i = 0; i < 4; i++) {
            let sx = 2 * x - 1 + i;
            sx = wrap ? (sx + w) % w : Math.min(w - 1, Math.max(0, sx));
            acc += src.d[(sy * w + sx) * c + ch] * wt[i] * wt[j];
          }
        }
        out.d[(y * W + x) * c + ch] = acc;
      }
    }
  }
  return out;
}

export function luminance(rgb: Img): Img {
  const out = makeImg(rgb.w, rgb.h, 1);
  for (let i = 0; i < out.d.length; i++) out.d[i] = 0.2126 * rgb.d[i * 3] + 0.7152 * rgb.d[i * 3 + 1] + 0.0722 * rgb.d[i * 3 + 2];
  return out;
}

/** RGBA8 bytes; colour channels encoded to sRGB when `srgb`. A 1-channel image becomes grey. */
export function toRGBA8(src: Img, srgb: boolean): Uint8Array {
  const n = src.w * src.h;
  const out = new Uint8Array(n * 4);
  const enc = srgb ? linearToSrgb : (x: number) => x;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = src.c === 1 ? src.d[i] : src.d[i * src.c + k];
      out[i * 4 + k] = Math.round(Math.min(1, Math.max(0, enc(v))) * 255);
    }
    out[i * 4 + 3] = src.c === 4 ? Math.round(Math.min(1, Math.max(0, src.d[i * 4 + 3])) * 255) : 255;
  }
  return out;
}

export async function writePng(path: string, src: Img, opts: { srgb: boolean } = { srgb: true }) {
  await sharp(toRGBA8(src, opts.srgb), { raw: { width: src.w, height: src.h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path);
}

/** Height in metres to a 16-bit grey PNG, mapped over [lo, hi]. */
export async function writeHeightPng(path: string, src: Img, lo: number, hi: number) {
  const u = new Uint16Array(src.w * src.h);
  for (let i = 0; i < u.length; i++) u[i] = Math.round(Math.min(1, Math.max(0, (src.d[i] - lo) / (hi - lo))) * 65535);
  await sharp(u, { raw: { width: src.w, height: src.h, channels: 1 } })
    .toColourspace('grey16')
    .png({ compressionLevel: 9 })
    .toFile(path);
}

/** Read an image as linear RGB (from sRGB) at its own size, or resized with wrap when `tile`. */
export async function readRgb(path: string | Buffer, size?: { w: number; h: number; tile: boolean }): Promise<Img> {
  let s = sharp(path).removeAlpha();
  if (size) {
    const meta = await sharp(path).metadata();
    const pad = size.tile ? Math.ceil(Math.max(meta.width ?? 0, meta.height ?? 0) / 16) : 0;
    if (pad) {
      // Resize a padded, wrapped copy and crop, so the filter sees across the seam.
      const padded = await s.extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'repeat' }).toBuffer();
      const sx = size.w / (meta.width ?? size.w);
      const sy = size.h / (meta.height ?? size.h);
      const pw = Math.round(pad * sx);
      const ph = Math.round(pad * sy);
      s = sharp(await sharp(padded).resize(size.w + 2 * pw, size.h + 2 * ph, { kernel: 'lanczos3', fit: 'fill' }).toBuffer()).extract({
        left: pw,
        top: ph,
        width: size.w,
        height: size.h,
      });
    } else {
      s = s.resize(size.w, size.h, { kernel: 'lanczos3', fit: 'fill' });
    }
  }
  const { data, info } = await s.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const out = makeImg(info.width, info.height, 3);
  for (let i = 0; i < info.width * info.height; i++) {
    for (let k = 0; k < 3; k++) out.d[i * 3 + k] = srgbToLinear(data[i * info.channels + k] / 255);
  }
  return out;
}

/**
 * How visible the wrap seam is: the mean colour step across the left/right and top/bottom edges,
 * divided by the mean step one and two texels in from each edge. About 1 for a clean tile; a
 * seam that wasn't fixed scores several times that.
 */
export function seamRatio(src: Img): number {
  const { w, h, c } = src;
  const px = (x: number, y: number, k: number) => src.d[(((y + h) % h) * w + ((x + w) % w)) * c + k];
  let edge = 0;
  let near = 0;
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < c; k++) {
      edge += Math.abs(px(0, y, k) - px(-1, y, k));
      for (const x of [1, 2, -1, -2]) near += Math.abs(px(x, y, k) - px(x - 1, y, k)) / 4;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let k = 0; k < c; k++) {
      edge += Math.abs(px(x, 0, k) - px(x, -1, k));
      for (const y of [1, 2, -1, -2]) near += Math.abs(px(x, y, k) - px(x, y - 1, k)) / 4;
    }
  }
  return edge / Math.max(1e-6, near);
}
