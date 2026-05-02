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

export type SpeciesConfig = {
  id: string;
  axiom: string;
  iterations: number;
  rules: ProductionRule[];
  walk: WalkParams;
  asset: AssetBinding;
};
