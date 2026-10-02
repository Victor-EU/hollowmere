// KTX2 encoding through Basis Universal (ktx2-encoder's WASM build), so no native tools are needed.

import { encodeToKTX2 } from 'ktx2-encoder';
import { toRGBA8, type Img } from './image.ts';

let ready: Promise<unknown> | null = null;

/**
 * The encoder prints a line per mip level through whatever console.log was when its module
 * started, so start it with a tiny warm-up encode while console.log is silenced.
 */
function init() {
  ready ??= (async () => {
    const log = console.log;
    console.log = () => {};
    try {
      const data = new Uint8Array(4 * 4 * 4);
      await encodeToKTX2(new Uint8Array(0), { imageDecoder: async () => ({ data, width: 4, height: 4 }), isUASTC: false });
    } finally {
      console.log = log;
    }
  })();
  return ready;
}

export interface EncodeOptions {
  mode: 'etc1s' | 'uastc';
  /** Colour data (albedo, emissive) is sRGB; normals are linear. */
  srgb: boolean;
  normalMap?: boolean;
}

export async function encodeKtx2(img: Img, o: EncodeOptions): Promise<Uint8Array> {
  await init();
  const data = toRGBA8(img, o.srgb);
  const uastc = o.mode === 'uastc';
  return encodeToKTX2(new Uint8Array(0), {
    imageDecoder: async () => ({ data, width: img.w, height: img.h }),
    isUASTC: uastc,
    // ETC1S: quality 1..255. UASTC: zstd plus rate-distortion optimisation keeps files small.
    qualityLevel: 200,
    compressionLevel: 2,
    needSupercompression: uastc,
    enableRDO: uastc,
    rdoQualityLevel: 1,
    uastcLDRQualityLevel: 2,
    isNormalMap: !!o.normalMap,
    isPerceptual: o.srgb,
    isSetKTX2SRGBTransferFunc: o.srgb,
    generateMipmap: true,
    // KTX2 can't be flipped on upload; store it bottom row first so v = 0 is the image's bottom.
    isYFlip: true,
    isKTX2File: true,
  });
}
