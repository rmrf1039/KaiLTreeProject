import { SEG_STRIDE, LEAF_STRIDE } from '../../../shared/src/types';
import { CAPS } from './grammar';
import { Xorshift32 } from './rng';

export type Geometry = {
  segments: Float32Array;
  segmentCount: number;
  leaves: Float32Array;
  leafCount: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

export type WalkParams = {
  initialLen: number;
  lenDecay: number;
  angleDeg: number;
  jitterDeg: number;
  atlasSlots: number;
  variantsPerSlot: number;
};

export function walk(expanded: string, seed: number, params: WalkParams): Geometry {
  const rng = new Xorshift32(seed ^ 0x9e3779b9);

  const segments = new Float32Array(CAPS.maxSegments * SEG_STRIDE);
  const leaves = new Float32Array(CAPS.maxLeaves * LEAF_STRIDE);
  let segCount = 0;
  let leafCount = 0;

  let x = 0;
  let y = 0;
  let ang = -Math.PI / 2;
  let len = params.initialLen;
  let depth = 0;
  // 0 = left branch, 1 = middle/trunk, 2 = right branch.
  // Determines fan-layered z-order at each branching point.
  let side = 1;

  const angleStep = (params.angleDeg * Math.PI) / 180;
  const jitter = (params.jitterDeg * Math.PI) / 180;

  type StackFrame = [x: number, y: number, ang: number, len: number, depth: number, side: number];
  const stack: StackFrame[] = [];

  let minX = 0, maxX = 0, minY = 0, maxY = 0;

  for (let i = 0; i < expanded.length; i++) {
    const c = expanded[i];
    if (c === 'F') {
      const x1 = x + Math.cos(ang) * len;
      const y1 = y + Math.sin(ang) * len;
      if (segCount < CAPS.maxSegments) {
        const o = segCount * SEG_STRIDE;
        segments[o] = x;
        segments[o + 1] = y;
        segments[o + 2] = x1;
        segments[o + 3] = y1;
        segments[o + 4] = depth;
        segments[o + 5] = segCount;
        segments[o + 6] = side;
        segCount++;
      }
      x = x1;
      y = y1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (c === '+') {
      ang -= angleStep + (rng.next() - 0.5) * jitter;
    } else if (c === '-') {
      ang += angleStep + (rng.next() - 0.5) * jitter;
    } else if (c === '[') {
      // Peek at the next rotation char to decide which "side" this new
      // branch represents — drives the fan z-order in the renderer.
      const next = expanded[i + 1];
      const nextSide = next === '+' ? 0 : next === '-' ? 2 : 1;
      stack.push([x, y, ang, len, depth, side]);
      if (depth < CAPS.maxDepth) {
        len *= params.lenDecay;
        depth++;
      }
      side = nextSide;
    } else if (c === ']') {
      const f = stack.pop();
      if (f) {
        x = f[0];
        y = f[1];
        ang = f[2];
        len = f[3];
        depth = f[4];
        side = f[5];
      }
    } else if (c === 'X') {
      if (leafCount < CAPS.maxLeaves) {
        const o = leafCount * LEAF_STRIDE;
        const slot = rng.int(params.atlasSlots);
        const variant = rng.int(params.variantsPerSlot);
        const atlasIdx = slot * params.variantsPerSlot + variant;
        leaves[o] = x;
        leaves[o + 1] = y;
        leaves[o + 2] = ang + rng.range(-0.6, 0.6);
        leaves[o + 3] = 0.75 + rng.next() * 0.5;
        leaves[o + 4] = atlasIdx;
        leaves[o + 5] = segCount;
        leafCount++;
      }
    }
  }

  const segDivisor = Math.max(1, segCount);
  for (let i = 0; i < segCount; i++) {
    segments[i * SEG_STRIDE + 5] = (i + 1) / segDivisor;
  }
  for (let i = 0; i < leafCount; i++) {
    const atSeg = leaves[i * LEAF_STRIDE + 5]!;
    leaves[i * LEAF_STRIDE + 5] = Math.min(1, (atSeg + 1) / segDivisor);
  }

  return {
    segments,
    segmentCount: segCount,
    leaves,
    leafCount,
    bounds: { minX, maxX, minY, maxY },
  };
}
