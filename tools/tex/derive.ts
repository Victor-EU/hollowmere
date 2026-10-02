// Maps a generated image doesn't come with: relief from luminance, glow from warm bright pixels.

import { blur, luminance, makeImg, type Img } from './image.ts';
import { smoothstep } from './noise.ts';

/** Generated images carry no relief: take it from local luminance contrast. */
export function heightFromLuminance(albedo: Img, tile: number, metres: number): Img {
  const lum = luminance(albedo);
  const px = tile / albedo.w;
  const local = blur(lum, 0.4 / px);
  const out = makeImg(albedo.w, albedo.h, 1);
  for (let i = 0; i < out.d.length; i++) out.d[i] = (lum.d[i] - local.d[i]) * metres;
  return out;
}

/** Generated atlases: warm, bright pixels are lit glass. */
export function emissiveFromAlbedo(albedo: Img, minLum: number, minWarmth: number): Img {
  const out = makeImg(albedo.w, albedo.h, 3);
  for (let i = 0; i < albedo.w * albedo.h; i++) {
    const r = albedo.d[i * 3];
    const g = albedo.d[i * 3 + 1];
    const b = albedo.d[i * 3 + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const warmth = (r - b) / (r + b + 1e-4);
    const k = smoothstep(minLum, minLum + 0.15, lum) * smoothstep(minWarmth, minWarmth + 0.15, warmth);
    out.d[i * 3] = r * k;
    out.d[i * 3 + 1] = g * k;
    out.d[i * 3 + 2] = b * k;
  }
  return out;
}
