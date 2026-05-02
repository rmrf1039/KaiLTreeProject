import type { SpeciesConfig } from '../../../shared/src/species/types.js';
import { DEFAULT_SPECIES_CONFIG } from '../../../shared/src/species/defaults.js';

export type SpeciesRegistryEntry = SpeciesConfig & {
  // Substrings (NFKC-lowercased) that, if found in the CSV `treeType` column,
  // map that record to this config. Stripped before transmission.
  matchPatterns: string[];
};

// Spreading/umbrella crowns: Ficus microcarpa (榕樹), Bischofia javanica (茄苳),
// Cinnamomum camphora (樟樹). Wide lateral angles, short children, occasional
// 4-way fan to widen the canopy.
const SPREADING_BROADLEAF: SpeciesRegistryEntry = {
  id: 'spreading-broadleaf',
  matchPatterns: ['榕樹', '茄苳', '樟樹', 'ficus', 'cinnamomum', 'bischofia'],
  axiom: 'FFFX',
  iterations: 5,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 0.45, expansion: 'F[++X][--X]FX' },
        { weight: 0.30, expansion: 'F[+++X][-X][+X][---X]FX' },
        { weight: 0.25, expansion: 'FF[++X][--X]X' },
      ],
    },
  ],
  walk: {
    initialLength: 10,
    lengthDecay: 0.72,
    angleDeg: 30,
    jitterDeg: 6,
    trunkContraction: 0.88,
    childWidthMin: 0.85,
    childWidthSpan: 0.13,
    maxDepth: 8,
  },
  asset: {
    segmentAspect: 1.05,
    leafSizeScale: 1.18,
  },
  stressResponse: {
    angleDamp: 0.25,
    lengthDamp: 0.20,
    jitterGain: 8,
    iterationDrop: 1,
  },
};

// Columnar/spire silhouettes: Melaleuca (白千層), Bombax (木棉). Narrow angles,
// strong central leader, alternating single side-branches.
const COLUMNAR_NARROW: SpeciesRegistryEntry = {
  id: 'columnar-narrow',
  matchPatterns: ['白千層', '木棉', 'melaleuca', 'bombax'],
  axiom: 'FFFFFX',
  iterations: 5,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 0.5, expansion: 'FF[+X]FFX' },
        { weight: 0.5, expansion: 'FF[-X]FFX' },
      ],
    },
  ],
  walk: {
    initialLength: 9,
    lengthDecay: 0.88,
    angleDeg: 14,
    jitterDeg: 4,
    trunkContraction: 0.94,
    childWidthMin: 0.78,
    childWidthSpan: 0.10,
    maxDepth: 8,
  },
  asset: {
    segmentAspect: 0.72,
    leafSizeScale: 0.85,
  },
  stressResponse: {
    angleDamp: 0.10,
    lengthDamp: 0.30,
    jitterGain: 12,
    iterationDrop: 1,
  },
};

// Pagoda/layered silhouettes: Terminalia mantaly (小葉欖仁), Alstonia scholaris
// (黑板樹). Long FFF gaps on the trunk between near-horizontal whorls produces
// the iconic tiered look. lengthDecay is aggressive so children stay short.
const PAGODA_LAYERED: SpeciesRegistryEntry = {
  id: 'pagoda-layered',
  matchPatterns: ['小葉欖仁', '黑板樹', 'terminalia', 'alstonia'],
  axiom: 'FFFFFX',
  iterations: 5,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 0.50, expansion: 'FFF[+++X][---X]FFFX' },
        { weight: 0.30, expansion: 'FFF[+++X][-X][+X][---X]FFX' },
        { weight: 0.20, expansion: 'FFF[++X][--X]X' },
      ],
    },
  ],
  walk: {
    initialLength: 10,
    lengthDecay: 0.65,
    angleDeg: 28,
    jitterDeg: 5,
    trunkContraction: 0.90,
    childWidthMin: 0.80,
    childWidthSpan: 0.12,
    maxDepth: 8,
  },
  asset: {
    segmentAspect: 0.92,
    leafSizeScale: 1.05,
  },
  stressResponse: {
    angleDamp: 0.15,
    lengthDamp: 0.25,
    jitterGain: 10,
    iterationDrop: 1,
  },
};

export const SPECIES_REGISTRY: SpeciesRegistryEntry[] = [
  SPREADING_BROADLEAF,
  COLUMNAR_NARROW,
  PAGODA_LAYERED,
  { ...DEFAULT_SPECIES_CONFIG, matchPatterns: [] },
];
