export type ProductionVariant = {
  weight: number;
  expansion: string;
};

export type ProductionRule = {
  symbol: string;
  variants: ProductionVariant[];
};

export type WalkParams = {
  initialLength: number;
  lengthDecay: number;
  angleDeg: number;
  jitterDeg: number;
  trunkContraction: number;
  childWidthMin: number;
  childWidthSpan: number;
  maxDepth: number;
};

// Rendering-only knobs. Engine never reads these — they ride through the
// pipeline alongside geometry to drive scene-level draw decisions.
export type AssetBinding = {
  // Multiplies the perpendicular width of each segment tile. <1 = narrower
  // (e.g. columnar species), >1 = broader. Identity = 1.
  segmentAspect: number;
  // Multiplies the on-screen leaf tile size. Identity = 1.
  leafSizeScale: number;
};

// Per-species response curve to environmental stress. All factors scale
// linearly with `s ∈ [0,1]`. Damps multiply (1 - s*damp); gains add s*gain;
// iterationDrop floors `s * drop` and subtracts (clamped to keep iterations ≥ 1).
export type StressResponse = {
  angleDamp: number;
  lengthDamp: number;
  jitterGain: number;
  iterationDrop: number;
};

export type SpeciesConfig = {
  id: string;
  axiom: string;
  iterations: number;
  rules: ProductionRule[];
  walk: WalkParams;
  asset: AssetBinding;
  stressResponse?: StressResponse;
};

// External modifiers fed into the resolver pipeline. Composable, additive —
// new fields land here and gain a corresponding `apply*` transform.
export type Modifiers = {
  // 0 = healthy, 1 = maximally stressed. Out-of-range values are clamped.
  stress?: number;
};
