import { LEAF_STRIDE, RECT_STRIDE, SEG_STRIDE } from '../../../shared/src/types';
import type { BuildResult } from './worker';

const GROWTH_MS = 6000;
const FRAME_BUDGET_MS = 14;
const ADAPTIVE_FLOOR = 0.4;
const FRAME_WINDOW = 60;

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export class Scene {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private segments: Float32Array | null;
  private leaves: Float32Array | null;
  private atlas: ImageBitmap | null;
  private rects: Float32Array | null;
  private segAtlas: ImageBitmap | null;
  private segRects: Float32Array | null;
  private segVariantsTotal: number;
  private segmentCount: number;
  private leafCount: number;
  private bounds: { minX: number; maxX: number; minY: number; maxY: number };
  private rafHandle: number | null = null;
  private startMs = 0;
  private disposed = false;
  private leafCap: number;
  private frameTimes = new Float32Array(FRAME_WINDOW);
  private frameTimeIdx = 0;
  private frameTimeLen = 0;

  constructor(canvas: HTMLCanvasElement, data: BuildResult) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2d context unavailable');
    this.ctx = ctx;
    this.segments = data.segments;
    this.leaves = data.leaves;
    this.atlas = data.atlas;
    this.rects = data.rects;
    this.segAtlas = data.segAtlas;
    this.segRects = data.segRects;
    this.segVariantsTotal = data.segVariantsTotal;
    this.segmentCount = data.segmentCount;
    this.leafCount = data.leafCount;
    this.leafCap = data.leafCount;
    this.bounds = data.bounds;
  }

  start(): void {
    this.startMs = performance.now();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    const t0 = now;
    const elapsed = now - this.startMs;
    const t = easeInOutCubic(Math.min(1, elapsed / GROWTH_MS));
    this.draw(t, now);

    const frameTime = performance.now() - t0;
    this.frameTimes[this.frameTimeIdx] = frameTime;
    this.frameTimeIdx = (this.frameTimeIdx + 1) % FRAME_WINDOW;
    if (this.frameTimeLen < FRAME_WINDOW) this.frameTimeLen++;

    if (this.frameTimeLen >= 20) {
      let sum = 0;
      for (let i = 0; i < this.frameTimeLen; i++) sum += this.frameTimes[i]!;
      const avg = sum / this.frameTimeLen;
      if (avg > FRAME_BUDGET_MS) {
        const floor = Math.floor(this.leafCount * ADAPTIVE_FLOOR);
        if (this.leafCap > floor) {
          this.leafCap = Math.max(floor, Math.floor(this.leafCap * 0.75));
        }
      }
    }

    this.rafHandle = requestAnimationFrame(this.tick);
  };

  private draw(t: number, now: number): void {
    const { ctx, canvas, segments, leaves, atlas, rects, segAtlas, segRects } = this;
    if (!segments || !leaves || !atlas || !rects || !segAtlas || !segRects) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const padding = 60;
    const treeW = Math.max(1, this.bounds.maxX - this.bounds.minX);
    const treeH = Math.max(1, this.bounds.maxY - this.bounds.minY);
    // Cap height to 78% of canvas so tiles stay large enough to read
    const maxH = canvas.height * 0.78;
    const scale =
      Math.min((canvas.width - 2 * padding) / treeW, maxH / treeH);
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.90;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const windPhase = now * 0.0006;
    const segVariantsTotal = Math.max(1, this.segVariantsTotal);

    const segCount = this.segmentCount;

    // Find max depth so we can draw parents first, children on top
    let maxDepth = 0;
    for (let i = 0; i < segCount; i++) {
      const d = segments[i * SEG_STRIDE + 4]!;
      if (d > maxDepth) maxDepth = d;
    }

    // Fan-layered draw order: shallow depths first (parent under child),
    // and within each depth, side 0 (left) → 1 (middle) → 2 (right) so
    // the right child ends up on top of middle, middle on top of left,
    // and all siblings sit on top of their parent.
    for (let d = 0; d <= maxDepth; d++) {
      for (let s = 0; s <= 2; s++) {
        for (let i = 0; i < segCount; i++) {
          const o = i * SEG_STRIDE;
          const segT = segments[o + 5]!;
          if (segT > t) break;
          const depth = segments[o + 4]!;
          const segSide = segments[o + 6]!;
          if (depth !== d || segSide !== s) continue;

          const x0 = segments[o]!;
          const y0 = segments[o + 1]!;
          const x1 = segments[o + 2]!;
          const y1 = segments[o + 3]!;

          const mx = (x0 + x1) / 2;
          const my = (y0 + y1) / 2;
          const segLen = Math.hypot(x1 - x0, y1 - y0);

          // Per-segment, seed-derived jitter (0..1) → signed wobble in [-0.5, 0.5].
          // Makes every seed produce a visually distinct tree rather than
          // identical tiling across trees with similar structure.
          const jit = (segments[o + 7]! - 0.5);

          // Per-branch width factor (<= 1, monotonically non-increasing with
          // depth). Keeps the physics right — a child is never wider than
          // its parent — while letting sibling branches have diverse widths.
          const branchWidth = segments[o + 8]!;

          // Rectangular tile: long edge matches the branch length (edges of
          // adjacent tiles meet exactly, no overflow past endpoints); short
          // edge is narrower so branches don't bleed sideways into neighbors.
          // Small seed-driven scale wobble (±4%) adds organic variety.
          const scaleWobble = 1 + jit * 0.08;
          const tileH = segLen * 1.02 * scaleWobble;
          const tileW = segLen * 0.48 * scaleWobble * branchWidth;

          // Rotate so photo's "up" aligns with the branch's forward direction,
          // plus a small seed-driven rotation jitter (~±5°) so each tile sits
          // at a slightly different tilt — unique per seed, stable per tile.
          const photoRot = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2 + jit * 0.18;

          const sway = Math.sin(windPhase + depth * 0.35) * depth * 0.12;

          const atlasIdx = i % segVariantsTotal;
          const ri = atlasIdx * RECT_STRIDE;
          const sx = segRects[ri]!;
          const sy = segRects[ri + 1]!;
          const sw = segRects[ri + 2]!;
          const sh = segRects[ri + 3]!;

          // 3D depth via opacity:
          //  - Deeper branches fade more, as if receding into atmosphere.
          //  - Fan-back (left) sits further from viewer than fan-front
          //    (right), so shift alpha by side to reinforce the layering.
          //  - Clamp so the deepest tiles stay readable, not invisible.
          const depthFade = Math.max(0.5, 1 - depth * 0.11);
          const sideShift = s === 0 ? -0.12 : s === 2 ? 0.02 : -0.05;
          ctx.globalAlpha = Math.max(0.35, Math.min(1, depthFade + sideShift));

          ctx.save();
          ctx.translate(mx + sway, my);
          ctx.rotate(photoRot);
          // After rotate: local Y is along branch, local X is perpendicular
          ctx.drawImage(segAtlas, sx, sy, sw, sh, -tileW / 2, -tileH / 2, tileW, tileH);
          ctx.restore();
        }
      }
    }

    ctx.globalAlpha = 1;

    const leafCount = Math.min(this.leafCount, this.leafCap);
    const leafSizeScreen = 52;
    const leafH = leafSizeScreen / scale;
    for (let i = 0; i < leafCount; i++) {
      const o = i * LEAF_STRIDE;
      const appT = leaves[o + 5]!;
      if (appT > t) continue;
      const x = leaves[o]!;
      const y = leaves[o + 1]!;
      const angle = leaves[o + 2]!;
      const s = leaves[o + 3]!;
      const atlasIdx = (leaves[o + 4]! | 0) % segVariantsTotal;
      const ri = atlasIdx * RECT_STRIDE;
      const sx = segRects[ri]!;
      const sy = segRects[ri + 1]!;
      const sw = segRects[ri + 2]!;
      const sh = segRects[ri + 3]!;
      const sway = Math.sin(windPhase * 1.3 + atlasIdx * 0.25) * 0.03;
      const lh = leafH * s;
      const lw = lh * 0.75;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + sway);
      ctx.drawImage(segAtlas, sx, sy, sw, sh, -lh / 2, -lw / 2, lh, lw);
      ctx.restore();
    }

    ctx.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    try { this.atlas?.close(); } catch { /* already closed */ }
    try { this.segAtlas?.close(); } catch { /* already closed */ }
    this.atlas = null;
    this.segAtlas = null;
    this.segments = null;
    this.leaves = null;
    this.rects = null;
    this.segRects = null;
  }
}
