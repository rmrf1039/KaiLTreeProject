import type { SpeciesConfig } from './types.js';

// Mirrors the values previously hardcoded in:
//   - client/src/lsystem/grammar.ts (axiom, iterations, X-rule weights/expansions)
//   - client/src/lsystem/turtle.ts  (trunkContraction 0.92, childWidth 0.88+rng*0.12, maxDepth 8)
//   - client/src/pages/DisplayPage.tsx (initialLen, lenDecay, angleDeg, jitterDeg)
// Any change here is a behaviour change.
export const DEFAULT_SPECIES_CONFIG: SpeciesConfig = {
  id: 'default',
  axiom: 'FFFX',
  iterations: 5,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 0.75, expansion: 'F[+X][-X]FX' },
        { weight: 0.25, expansion: 'FF[+X][-X]FX' },
      ],
    },
  ],
  walk: {
    initialLength: 10,
    lengthDecay: 0.78,
    angleDeg: 45,
    jitterDeg: 5,
    trunkContraction: 0.92,
    childWidthMin: 0.88,
    childWidthSpan: 0.12,
    maxDepth: 8,
    gravity: 0,
  },
  asset: {
    segmentAspect: 1,
    leafSizeScale: 1,
  },
};
