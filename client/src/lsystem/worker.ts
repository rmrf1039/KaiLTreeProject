import { buildAtlas, buildSegAtlas } from './atlas';
import { expand } from './grammar';
import { walk } from './turtle';

export type BuildMsg = {
  type: 'build';
  seed: number;
  images: ImageBitmap[];
  atlasSize: number;
  variantsPerSlot: number;
  params: {
    initialLen: number;
    lenDecay: number;
    angleDeg: number;
    jitterDeg: number;
  };
};

export type BuildResult = {
  type: 'build-result';
  iterations: number;
  stringLength: number;
  segments: Float32Array;
  segmentCount: number;
  leaves: Float32Array;
  leafCount: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  atlas: ImageBitmap;
  rects: Float32Array;
  trunkColorARGB: number;
  atlasSlots: number;
  variantsPerSlot: number;
  segAtlas: ImageBitmap;
  segRects: Float32Array;
  segVariantsTotal: number;
};

self.addEventListener('message', async (event: MessageEvent<BuildMsg>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'build') return;

  try {
    const { str, iterations } = expand(msg.seed);
    const atlasSlots = Math.max(1, msg.images.length);
    const geometry = walk(str, msg.seed, {
      initialLen: msg.params.initialLen,
      lenDecay: msg.params.lenDecay,
      angleDeg: msg.params.angleDeg,
      jitterDeg: msg.params.jitterDeg,
      atlasSlots,
      variantsPerSlot: msg.variantsPerSlot,
    });
    const SEG_VARIANTS_PER_SLOT = 3;
    const [atlasResult, segAtlasResult] = await Promise.all([
      buildAtlas(msg.images, msg.variantsPerSlot, msg.atlasSize, msg.seed),
      buildSegAtlas(msg.images, SEG_VARIANTS_PER_SLOT, 1024, msg.seed),
    ]);

    const result: BuildResult = {
      type: 'build-result',
      iterations,
      stringLength: str.length,
      segments: geometry.segments,
      segmentCount: geometry.segmentCount,
      leaves: geometry.leaves,
      leafCount: geometry.leafCount,
      bounds: geometry.bounds,
      atlas: atlasResult.atlas,
      rects: atlasResult.rects,
      trunkColorARGB: atlasResult.trunkColorARGB,
      atlasSlots,
      variantsPerSlot: msg.variantsPerSlot,
      segAtlas: segAtlasResult.atlas,
      segRects: segAtlasResult.rects,
      segVariantsTotal: segAtlasResult.totalVariants,
    };

    (self as unknown as Worker).postMessage(result, [
      result.segments.buffer,
      result.leaves.buffer,
      result.atlas,
      result.rects.buffer,
      result.segAtlas,
      result.segRects.buffer,
    ]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'build-error', message: (err as Error).message });
  }
});
