import type { WalkParams } from '../../../shared/src/species/types';
import { SEG_STRIDE, LEAF_STRIDE } from '../../../shared/src/types';
import { CAPS } from './grammar';
import { Xorshift32 } from './rng';

export type Geometry = {
  segments: Float32Array;
  segmentCount: number;
  leaves: Float32Array;
  leafCount: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  // Per-branch hierarchy for skeletal animation:
  //  - branchParents[b] = parent branch id (root's parent is itself = 0)
  //  - branchOriginX/Y[b] = world position where branch `b` attaches to parent
  branchParents: Uint16Array;
  branchOriginX: Float32Array;
  branchOriginY: Float32Array;
  branchDepth: Uint8Array;
  branchCount: number;
};

export type AtlasMeta = {
  atlasSlots: number;
  variantsPerSlot: number;
};

export function walk(
  expanded: string,
  seed: number,
  walkParams: WalkParams,
  atlasMeta: AtlasMeta,
): Geometry {
  const rng = new Xorshift32(seed ^ 0x9e3779b9);

  const segments = new Float32Array(CAPS.maxSegments * SEG_STRIDE);
  const leaves = new Float32Array(CAPS.maxLeaves * LEAF_STRIDE);
  let segCount = 0;
  let leafCount = 0;

  let x = 0;
  let y = 0;
  let ang = -Math.PI / 2;
  let len = walkParams.initialLength;
  let depth = 0;
  // 0 = left branch, 1 = middle/trunk, 2 = right branch.
  // Determines fan-layered z-order at each branching point.
  let side = 1;
  // Per-branch tile width multiplier — constant within a branch, randomised
  // when entering a new `[`, restored when leaving. Gives the tree visually
  // diverse limb widths (some thin, some chunky) rather than uniform ribs.
  let widthFactor = 1;

  // Branch hierarchy (skeletal): root is branch 0 with no parent.
  let branchId = 0;
  let nextBranchId = 1;
  const branchParentsList: number[] = [0];
  const branchOriginXList: number[] = [0];
  const branchOriginYList: number[] = [0];
  const branchDepthList: number[] = [0];

  const angleStep = (walkParams.angleDeg * Math.PI) / 180;
  const jitter = (walkParams.jitterDeg * Math.PI) / 180;
  // Engine-level safety floor — config can request a shallower tree but never deeper.
  const depthCap = Math.min(walkParams.maxDepth, CAPS.maxDepth);

  type StackFrame = [
    x: number,
    y: number,
    ang: number,
    len: number,
    depth: number,
    side: number,
    widthFactor: number,
    branchId: number,
  ];
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
        // Per-segment seed-derived jitter (0..1). The renderer turns this
        // into small, deterministic rotation/scale wobble so each seed
        // produces a visually unique tree rather than identical tiling.
        segments[o + 7] = rng.next();
        // Branch-level width factor (always <= parent's, see `[` handler).
        segments[o + 8] = widthFactor;
        // Branch id — drives skeletal per-branch sway in the renderer.
        segments[o + 9] = branchId;
        segCount++;
      }
      x = x1;
      y = y1;
      // Gravity bends the heading after each segment is laid down. Default
      // 0 is bit-identity (`ang + 0 === ang` for finite doubles); non-zero
      // values produce weeping/pendant branches that arc earthward.
      ang += walkParams.gravity;
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
      const parentBranch = branchId;
      stack.push([x, y, ang, len, depth, side, widthFactor, parentBranch]);
      if (depth < depthCap) {
        len *= walkParams.lengthDecay;
        depth++;
      }
      side = nextSide;
      // Child branch gets a width factor in [min, min+span] of the parent.
      // The RNG draw is unconditional — same number of draws regardless of
      // whether the depth cap stopped the descent above.
      widthFactor *= walkParams.childWidthMin + rng.next() * walkParams.childWidthSpan;
      // Register the new child branch: its origin is the current turtle
      // position (where the `[` sits), parent is the branch we're leaving.
      branchId = nextBranchId++;
      branchParentsList.push(parentBranch);
      branchOriginXList.push(x);
      branchOriginYList.push(y);
      branchDepthList.push(depth);
    } else if (c === ']') {
      const f = stack.pop();
      if (f) {
        x = f[0];
        y = f[1];
        ang = f[2];
        len = f[3];
        depth = f[4];
        side = f[5];
        widthFactor = f[6];
        branchId = f[7];
      }
      // After fully closing a branching group (next char is not another
      // sibling branch `[`), shorten the trunk segment length so each
      // successive splitting point on the trunk sits closer to the last —
      // lower branches get more breathing room than upper ones.
      if (expanded[i + 1] !== '[') {
        len *= walkParams.trunkContraction;
      }
    } else if (c === 'X') {
      if (leafCount < CAPS.maxLeaves) {
        const o = leafCount * LEAF_STRIDE;
        const slot = rng.int(atlasMeta.atlasSlots);
        const variant = rng.int(atlasMeta.variantsPerSlot);
        const atlasIdx = slot * atlasMeta.variantsPerSlot + variant;
        leaves[o] = x;
        leaves[o + 1] = y;
        leaves[o + 2] = ang + rng.range(-0.6, 0.6);
        leaves[o + 3] = 0.75 + rng.next() * 0.5;
        leaves[o + 4] = atlasIdx;
        leaves[o + 5] = segCount;
        leaves[o + 6] = branchId;
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
    branchParents: new Uint16Array(branchParentsList),
    branchOriginX: new Float32Array(branchOriginXList),
    branchOriginY: new Float32Array(branchOriginYList),
    branchDepth: new Uint8Array(branchDepthList),
    branchCount: nextBranchId,
  };
}
