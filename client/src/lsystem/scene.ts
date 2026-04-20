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
  // Pointer state (world coords). Infinity = pointer not over the canvas.
  private cursorWorldX = Infinity;
  private cursorWorldY = Infinity;
  private lastCursorMoveMs = -Infinity;
  // Last-frame transform (canvas → world) so pointer events can invert it.
  private tScale = 1;
  private tCx = 0;
  private tCy = 0;
  // Skeletal branch hierarchy.
  private branchParents: Uint16Array;
  private branchOriginX: Float32Array;
  private branchOriginY: Float32Array;
  private branchDepth: Uint8Array;
  private branchCount: number;
  private branchMidX: Float32Array;   // average midpoint per branch (for cursor proximity)
  private branchMidY: Float32Array;
  // Per-frame skeletal state: accumulated affine transform per branch.
  // A point p in branch b maps to final coords via:
  //   final = (bCos[b]*p.x - bSin[b]*p.y + bVx[b],
  //            bSin[b]*p.x + bCos[b]*p.y + bVy[b])
  private bAngle: Float32Array;
  private bCos: Float32Array;
  private bSin: Float32Array;
  private bVx: Float32Array;
  private bVy: Float32Array;
  // Smoothed local angle per branch: persisted across frames so each branch
  // eases toward its target bend instead of snapping, giving natural inertia.
  private bLocalAngleSmoothed: Float32Array;
  private lastFrameMs = 0;

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

    this.branchParents = data.branchParents;
    this.branchOriginX = data.branchOriginX;
    this.branchOriginY = data.branchOriginY;
    this.branchDepth = data.branchDepth;
    this.branchCount = data.branchCount;

    // Precompute each branch's average midpoint (used for cursor proximity).
    this.branchMidX = new Float32Array(this.branchCount);
    this.branchMidY = new Float32Array(this.branchCount);
    const counts = new Uint16Array(this.branchCount);
    for (let i = 0; i < this.segmentCount; i++) {
      const o = i * SEG_STRIDE;
      const b = (data.segments[o + 9]! | 0);
      const midX = (data.segments[o]! + data.segments[o + 2]!) * 0.5;
      const midY = (data.segments[o + 1]! + data.segments[o + 3]!) * 0.5;
      this.branchMidX[b]! += midX;
      this.branchMidY[b]! += midY;
      counts[b]!++;
    }
    for (let b = 0; b < this.branchCount; b++) {
      const c = counts[b]!;
      if (c > 0) {
        this.branchMidX[b]! /= c;
        this.branchMidY[b]! /= c;
      } else {
        // Branch has no F segments (can happen for the root if axiom has no
        // pre-`[` F's — treat origin as the midpoint fallback).
        this.branchMidX[b] = this.branchOriginX[b]!;
        this.branchMidY[b] = this.branchOriginY[b]!;
      }
    }

    this.bAngle = new Float32Array(this.branchCount);
    this.bCos = new Float32Array(this.branchCount);
    this.bSin = new Float32Array(this.branchCount);
    this.bVx = new Float32Array(this.branchCount);
    this.bVy = new Float32Array(this.branchCount);
    this.bLocalAngleSmoothed = new Float32Array(this.branchCount);
  }

  start(): void {
    this.startMs = performance.now();
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    // The canvas backing store may differ from its CSS size; scale accordingly.
    const sx = this.canvas.width / Math.max(1, rect.width);
    const sy = this.canvas.height / Math.max(1, rect.height);
    const canvasX = (e.clientX - rect.left) * sx;
    const canvasY = (e.clientY - rect.top) * sy;
    // Invert the draw() transform: canvas = world * scale + center.
    this.cursorWorldX = (canvasX - this.tCx) / this.tScale;
    this.cursorWorldY = (canvasY - this.tCy) / this.tScale;
    this.lastCursorMoveMs = performance.now();
  };

  private onPointerLeave = (): void => {
    this.cursorWorldX = Infinity;
    this.cursorWorldY = Infinity;
  };

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
    // Cache transform for pointer hit-testing on the next event.
    this.tScale = scale;
    this.tCx = cx;
    this.tCy = cy;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    const windPhase = now * 0.0006;
    const segVariantsTotal = Math.max(1, this.segVariantsTotal);

    // Pointer interaction — proximity to cursor adds local sway/shake.
    const cursorActive = isFinite(this.cursorWorldX);
    const cursorX = this.cursorWorldX;
    const cursorY = this.cursorWorldY;
    // Excitement fades after ~1.2s of no movement, so still tiles don't shake forever.
    const msSinceMove = now - this.lastCursorMoveMs;
    const activity = Math.max(0, 1 - msSinceMove / 1200);

    const segCount = this.segmentCount;

    // ---- Skeletal pass: compute each branch's accumulated transform ----
    // Every branch bends at its joint (its origin) by a small local angle,
    // and its transform cascades from its parent. Segments in the branch
    // are then rigidly moved by that transform, so they stay connected to
    // each other AND follow their parent's motion through the hierarchy.
    // Stiffness: shallow (trunk) branches barely rotate; deep branches are
    // thinner/more flexible and rotate much more — real-tree physics.
    const { branchParents, branchOriginX, branchOriginY, branchDepth,
            branchMidX, branchMidY, bAngle, bCos, bSin, bVx, bVy,
            bLocalAngleSmoothed } = this;
    const branchCount = this.branchCount;
    bAngle[0] = 0;
    bCos[0] = 1;
    bSin[0] = 0;
    bVx[0] = 0;
    bVy[0] = 0;

    // dt in seconds since last frame, clamped so a pause doesn't warp things.
    const dtMs = this.lastFrameMs === 0 ? 16 : Math.min(64, now - this.lastFrameMs);
    this.lastFrameMs = now;
    const dt = dtMs / 1000;
    // Smoothing rate: ~8/sec → time-to-~63% ≈ 1/8 s, time-to-~95% ≈ 0.37 s.
    // Exponential lerp is dt-correct so the feel is the same at any fps.
    const ease = 1 - Math.exp(-8 * dt);

    // ---- Global wind field (shared by every branch in the tree) ----
    // A gentle breeze: slowly drifting direction with occasional,
    // mild pressure changes. All branches see the same wind; each
    // responds with its own resonance (handled inside the per-branch loop).
    const wt = now * 0.001; // seconds
    // Very slow oscillations — periods of ~12 s, ~5 s, ~3 s.
    const breeze =
      0.45 * Math.sin(wt * 0.08) +
      0.28 * Math.sin(wt * 0.19 + 1.3) +
      0.16 * Math.sin(wt * 0.34 + 2.7);
    // Rare, soft "lulls & puffs" — half-wave rectified with a high
    // threshold so they only occasionally contribute.
    const gustPulse = Math.sin(wt * 0.22) + 0.35 * Math.sin(wt * 0.45 + 1.5);
    const gust = Math.max(0, gustPulse - 0.45) * 0.22;
    const breezeSign = breeze >= 0 ? 1 : -1;
    const globalWind = breeze + gust * breezeSign;
    for (let b = 1; b < branchCount; b++) {
      const p = branchParents[b]!;
      const ox = branchOriginX[b]!;
      const oy = branchOriginY[b]!;
      const bd = branchDepth[b]!;

      // Flexibility grows with depth (thinner → bends more). Capped so a
      // single branch can never locally rotate more than ~6° — cascades
      // can still add up, but no joint snaps unphysically on its own.
      const flex = Math.min(0.10, 0.012 * bd);

      // Per-branch resonance: each limb has its own natural frequency
      // (proxy for mass/stiffness) and phase. Slow range (0.25–0.65 Hz)
      // so even the "fastest" limb oscillates on a ~1.5 s cycle — quiet,
      // not jittery.
      const brFreq = 0.25 + ((b * 13) % 17) * 0.025;
      const brPhase = b * 1.7 + bd * 0.4;
      const resonance = Math.sin(wt * brFreq * 6.2832 + brPhase) * 0.18;

      // Target local angle: gentle global wind + subtle per-branch
      // resonance, scaled by the branch's flex so only thinner limbs
      // respond visibly to a breeze.
      let targetLocal = (globalWind * 0.32 + resonance) * flex;

      // Cursor-driven bend: force applied at the branch's midpoint creates
      // torque at the joint. Branch rotates AWAY from the cursor.
      if (cursorActive) {
        const mxB = branchMidX[b]!;
        const myB = branchMidY[b]!;
        const dxC = mxB - cursorX;
        const dyC = myB - cursorY;
        const dist = Math.hypot(dxC, dyC);
        const falloff = Math.exp(-dist / 30);
        // In canvas space (y-down), positive rotation is clockwise. A
        // cursor on the LEFT of a mostly-upright branch (dxC > 0) pushes
        // it clockwise/right (positive); cursor on the RIGHT pushes it
        // counter-clockwise/left (negative). i.e. away from the cursor.
        const sign = dxC > 0 ? 1 : -1;
        const intensity = falloff * flex * 1.6 * (0.55 + 0.45 * activity);
        targetLocal += sign * intensity;
      }

      // Ease toward the target angle instead of snapping — gives every
      // branch inertia, so wind gusts and cursor pushes ramp in/out
      // smoothly instead of popping.
      const prev = bLocalAngleSmoothed[b]!;
      const localAngle = prev + (targetLocal - prev) * ease;
      bLocalAngleSmoothed[b] = localAngle;

      // Parent cascade: total rotation = parent's total + this branch's local.
      const parentAngle = bAngle[p]!;
      const totalAngle = parentAngle + localAngle;
      bAngle[b] = totalAngle;
      const ctotal = Math.cos(totalAngle);
      const stotal = Math.sin(totalAngle);
      bCos[b] = ctotal;
      bSin[b] = stotal;

      // Translation update: v_c = v_p + M_p * (I - R_local) * origin[b]
      const cosL = Math.cos(localAngle);
      const sinL = Math.sin(localAngle);
      const ux = (1 - cosL) * ox + sinL * oy;
      const uy = -sinL * ox + (1 - cosL) * oy;
      const cosP = bCos[p]!;
      const sinP = bSin[p]!;
      bVx[b] = bVx[p]! + cosP * ux - sinP * uy;
      bVy[b] = bVy[p]! + sinP * ux + cosP * uy;
    }

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

          const rx0 = segments[o]!;
          const ry0 = segments[o + 1]!;
          const rx1 = segments[o + 2]!;
          const ry1 = segments[o + 3]!;

          // Apply the branch's skeletal transform to each endpoint.
          // This keeps all segments in a branch rigidly connected and makes
          // child branches follow their parent's motion through the chain.
          const bId = (segments[o + 9]! | 0);
          const tc = bCos[bId]!;
          const ts = bSin[bId]!;
          const tvx = bVx[bId]!;
          const tvy = bVy[bId]!;
          const x0 = tc * rx0 - ts * ry0 + tvx;
          const y0 = ts * rx0 + tc * ry0 + tvy;
          const x1 = tc * rx1 - ts * ry1 + tvx;
          const y1 = ts * rx1 + tc * ry1 + tvy;

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

          // All sway is already encoded in the skeletal transform above;
          // no per-segment offset is needed here.
          const sway = 0;

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
      const rx = leaves[o]!;
      const ry = leaves[o + 1]!;
      const angle = leaves[o + 2]!;
      const s = leaves[o + 3]!;
      const atlasIdx = (leaves[o + 4]! | 0) % segVariantsTotal;
      const bId = (leaves[o + 6]! | 0);
      const ri = atlasIdx * RECT_STRIDE;
      const sx = segRects[ri]!;
      const sy = segRects[ri + 1]!;
      const sw = segRects[ri + 2]!;
      const sh = segRects[ri + 3]!;

      // Apply the leaf's host-branch skeletal transform so the leaf moves
      // with its branch (stays attached at the tip instead of floating).
      const tc = bCos[bId]!;
      const ts = bSin[bId]!;
      const x = tc * rx - ts * ry + bVx[bId]!;
      const y = ts * rx + tc * ry + bVy[bId]!;
      // Leaf's own rotation also inherits the branch's total rotation so it
      // points "along" the branch correctly when the branch bends.
      const branchRot = bAngle[bId]!;
      const sway = Math.sin(windPhase * 1.3 + atlasIdx * 0.25) * 0.03;

      const lh = leafH * s;
      const lw = lh * 0.75;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + branchRot + sway);
      ctx.drawImage(segAtlas, sx, sy, sw, sh, -lh / 2, -lw / 2, lh, lw);
      ctx.restore();
    }

    ctx.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
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
