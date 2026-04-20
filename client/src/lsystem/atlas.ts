import { RECT_STRIDE } from '../../../shared/src/types';
import { Xorshift32 } from './rng';

export type AtlasResult = {
  atlas: ImageBitmap;
  rects: Float32Array;
  trunkColorARGB: number;
};

export type SegAtlasResult = {
  atlas: ImageBitmap;
  rects: Float32Array;
  totalVariants: number;
};

export async function buildAtlas(
  sources: ImageBitmap[],
  variantsPerSlot: number,
  atlasSize: number,
  seed: number,
): Promise<AtlasResult> {
  const canvas = new OffscreenCanvas(atlasSize, atlasSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const totalVariants = sources.length * variantsPerSlot;
  const cols = Math.ceil(Math.sqrt(totalVariants));
  const cell = Math.floor(atlasSize / cols);
  const rects = new Float32Array(totalVariants * RECT_STRIDE);
  const rng = new Xorshift32(seed ^ 0xa5a5a5a5);

  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, atlasSize, atlasSize);

  let trunkR = 0, trunkG = 0, trunkB = 0, trunkN = 0;

  for (let s = 0; s < sources.length; s++) {
    const src = sources[s]!;
    for (let v = 0; v < variantsPerSlot; v++) {
      const idx = s * variantsPerSlot + v;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const sx = col * cell;
      const sy = row * cell;

      const cropScale = 0.4 + rng.next() * 0.4;
      const cropW = Math.floor(src.width * cropScale);
      const cropH = Math.floor(src.height * cropScale);
      const cropX = rng.int(Math.max(1, src.width - cropW));
      const cropY = rng.int(Math.max(1, src.height - cropH));
      const rot = (rng.next() - 0.5) * 0.6;

      ctx.save();
      ctx.beginPath();
      ctx.arc(sx + cell / 2, sy + cell / 2, cell / 2 - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(sx + cell / 2, sy + cell / 2);
      ctx.rotate(rot);
      const baseScale = (cell * 1.15) / Math.min(cropW, cropH);
      ctx.scale(baseScale, baseScale);
      ctx.drawImage(src, cropX, cropY, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
      ctx.restore();

      const o = idx * RECT_STRIDE;
      rects[o] = sx;
      rects[o + 1] = sy;
      rects[o + 2] = cell;
      rects[o + 3] = cell;
    }

    // Sample trunk color from a small slice of the source
    const probe = new OffscreenCanvas(8, 8);
    const pctx = probe.getContext('2d');
    if (pctx) {
      pctx.drawImage(src, 0, 0, 8, 8);
      const data = pctx.getImageData(0, 0, 8, 8).data;
      for (let p = 0; p < data.length; p += 4) {
        const r = data[p]!;
        const g = data[p + 1]!;
        const b = data[p + 2]!;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 120) {
          trunkR += r;
          trunkG += g;
          trunkB += b;
          trunkN++;
        }
      }
    }
  }

  let trunkColorARGB = (0xff << 24) | (0x3a << 16) | (0x28 << 8) | 0x20;
  if (trunkN > 0) {
    const r = Math.round(trunkR / trunkN);
    const g = Math.round(trunkG / trunkN);
    const b = Math.round(trunkB / trunkN);
    trunkColorARGB = (0xff << 24) | (r << 16) | (g << 8) | b;
  }

  const atlas = canvas.transferToImageBitmap();
  return { atlas, rects, trunkColorARGB };
}

export async function buildSegAtlas(
  sources: ImageBitmap[],
  variantsPerSlot: number,
  atlasSize: number,
  seed: number,
): Promise<SegAtlasResult> {
  const canvas = new OffscreenCanvas(atlasSize, atlasSize);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');

  const totalVariants = sources.length * variantsPerSlot;
  const cols = Math.ceil(Math.sqrt(totalVariants));
  const cell = Math.floor(atlasSize / cols);
  const rects = new Float32Array(totalVariants * RECT_STRIDE);
  const rng = new Xorshift32(seed ^ 0xdeadbeef);

  ctx.clearRect(0, 0, atlasSize, atlasSize);

  for (let s = 0; s < sources.length; s++) {
    const src = sources[s]!;
    for (let v = 0; v < variantsPerSlot; v++) {
      const idx = s * variantsPerSlot + v;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const dx = col * cell;
      const dy = row * cell;

      const cropScale = 0.55 + rng.next() * 0.35;
      const cropW = Math.floor(src.width * cropScale);
      const cropH = Math.floor(src.height * cropScale);
      const cropX = rng.int(Math.max(1, src.width - cropW));
      const cropY = rng.int(Math.max(1, src.height - cropH));

      ctx.drawImage(src, cropX, cropY, cropW, cropH, dx, dy, cell, cell);

      const o = idx * RECT_STRIDE;
      rects[o] = dx;
      rects[o + 1] = dy;
      rects[o + 2] = cell;
      rects[o + 3] = cell;
    }
  }

  const atlas = canvas.transferToImageBitmap();
  return { atlas, rects, totalVariants };
}
