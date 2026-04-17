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
  private segmentCount: number;
  private leafCount: number;
  private bounds: { minX: number; maxX: number; minY: number; maxY: number };
  private trunkColor: string;
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
    this.segmentCount = data.segmentCount;
    this.leafCount = data.leafCount;
    this.leafCap = data.leafCount;
    this.bounds = data.bounds;
    const a = data.trunkColorARGB;
    const r = (a >>> 16) & 0xff;
    const g = (a >>> 8) & 0xff;
    const b = a & 0xff;
    this.trunkColor = `rgb(${r},${g},${b})`;
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
    const { ctx, canvas, segments, leaves, atlas, rects } = this;
    if (!segments || !leaves || !atlas || !rects) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const padding = 60;
    const treeW = Math.max(1, this.bounds.maxX - this.bounds.minX);
    const treeH = Math.max(1, this.bounds.maxY - this.bounds.minY);
    const scale =
      Math.min((canvas.width - 2 * padding) / treeW, (canvas.height - 2 * padding) / treeH) * 0.85;
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.92;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const windPhase = now * 0.0006;

    ctx.strokeStyle = this.trunkColor;
    ctx.lineCap = 'round';

    const segCount = this.segmentCount;
    for (let i = 0; i < segCount; i++) {
      const o = i * SEG_STRIDE;
      const segT = segments[o + 5]!;
      if (segT > t) break;
      const x0 = segments[o]!;
      const y0 = segments[o + 1]!;
      const x1 = segments[o + 2]!;
      const y1 = segments[o + 3]!;
      const depth = segments[o + 4]!;
      const sway = Math.sin(windPhase + depth * 0.35) * depth * 0.6;

      const widthScreen = Math.max(0.8, 7 - depth * 1.0);
      ctx.lineWidth = widthScreen / scale;
      ctx.beginPath();
      ctx.moveTo(x0 + sway * 0.2, y0);
      ctx.lineTo(x1 + sway, y1);
      ctx.stroke();
    }

    const leafCount = Math.min(this.leafCount, this.leafCap);
    const leafSizeScreen = 38;
    const leafSize = leafSizeScreen / scale;
    for (let i = 0; i < leafCount; i++) {
      const o = i * LEAF_STRIDE;
      const appT = leaves[o + 5]!;
      if (appT > t) continue;
      const x = leaves[o]!;
      const y = leaves[o + 1]!;
      const angle = leaves[o + 2]!;
      const s = leaves[o + 3]!;
      const atlasIdx = leaves[o + 4]! | 0;
      const r = atlasIdx * RECT_STRIDE;
      const sx = rects[r]!;
      const sy = rects[r + 1]!;
      const sw = rects[r + 2]!;
      const sh = rects[r + 3]!;
      const sway = Math.sin(windPhase * 1.3 + atlasIdx * 0.25) * 0.08;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + sway);
      const size = leafSize * s;
      ctx.drawImage(atlas, sx, sy, sw, sh, -size / 2, -size / 2, size, size);
      ctx.restore();
    }

    ctx.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    try {
      this.atlas?.close();
    } catch {
      /* bitmap already closed */
    }
    this.atlas = null;
    this.segments = null;
    this.leaves = null;
    this.rects = null;
  }
}
