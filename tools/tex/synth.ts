// The procedural stand-ins, picked by `synth.type` in prompts/<id>.yaml.

import { stainedGlass } from './glass.ts';
import type { Img } from './image.ts';
import { masonry, type MasonryParams } from './masonry.ts';
import { slate, type SlateParams } from './slate.ts';
import type { AssetSpec } from './spec.ts';
import { windowAtlas, type WindowAtlasParams } from './windows.ts';

export interface Maps {
  /** Linear RGB. */
  albedo: Img;
  /** Metres. */
  height?: Img;
  /** Linear RGB. */
  emissive?: Img;
}

export function synthesize(spec: AssetSpec, w: number, h: number): Maps {
  const { type, ...params } = spec.synth;
  const square = () => {
    if (w !== h) throw new Error(`${spec.id}: ${type} textures are square`);
    return { size: w, tile: spec.tile };
  };
  switch (type) {
    case 'masonry':
      return masonry({ ...(params as unknown as MasonryParams), ...square() });
    case 'windows':
      return windowAtlas({ ...(params as unknown as WindowAtlasParams), ...square() });
    case 'slate':
      return slate({ ...(params as unknown as SlateParams), ...square() });
    case 'glass': {
      const g = params as { seed: number; span: number; rise: number };
      return stainedGlass({ width: w, height: h, ...g });
    }
    default:
      throw new Error(`${spec.id}: unknown synth type "${type}"`);
  }
}
