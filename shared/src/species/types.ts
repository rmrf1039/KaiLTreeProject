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

export type SpeciesConfig = {
  id: string;
  axiom: string;
  iterations: number;
  rules: ProductionRule[];
  walk: WalkParams;
};
