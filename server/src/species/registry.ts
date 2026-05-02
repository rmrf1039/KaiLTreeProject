import type { SpeciesConfig } from '../../../shared/src/species/types.js';
import { DEFAULT_SPECIES_CONFIG } from '../../../shared/src/species/defaults.js';
import { validateRegistry } from './validate.js';

export type SpeciesRegistryEntry = SpeciesConfig & {
  // Substrings (NFKC-lowercased) that, if found in the CSV `treeType` column,
  // map that record to this config. Stripped before transmission.
  matchPatterns: string[];
};

// Spreading/umbrella crowns: Ficus microcarpa (榕樹), Bischofia javanica
// (茄苳), Cinnamomum camphora (樟樹), Ficus elastica (印度橡膠樹), Pterocarpus
// indicus (印度紫檀). Wide lateral angles, short children, occasional 4-way
// fan to widen the canopy. CSV ref: 榕樹 θ:60-90 r:0.8, 茄苳 θ:45-55 r:0.75.
const SPREADING_BROADLEAF: SpeciesRegistryEntry = {
  id: 'spreading-broadleaf',
  matchPatterns: [
    '榕樹', '茄苳', '樟樹', '印度橡膠樹', '印度紫檀',
    'ficus', 'cinnamomum', 'bischofia', 'pterocarpus',
  ],
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
    lengthDecay: 0.76,
    angleDeg: 32,
    jitterDeg: 6,
    trunkContraction: 0.88,
    childWidthMin: 0.85,
    childWidthSpan: 0.13,
    maxDepth: 8,
    gravity: 0,
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

// Columnar/spire silhouettes: Melaleuca (白千層), Garcinia subelliptica (福木).
// Narrow angles, strong central leader, alternating single side-branches.
// 木棉/Bombax was here previously but the CSV reclassifies it to a whorled
// horizontal morphology — moved to pagoda-layered.
const COLUMNAR_NARROW: SpeciesRegistryEntry = {
  id: 'columnar-narrow',
  matchPatterns: ['白千層', '福木', 'melaleuca', 'garcinia'],
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
    gravity: 0,
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

// Pagoda/layered silhouettes: Terminalia mantaly (小葉欖仁), Terminalia
// catappa (欖仁樹), Alstonia scholaris (黑板樹), Bombax ceiba (木棉),
// Chorisia/美人樹, Madhuca (大葉山欖). Long FFF gaps on the trunk between
// near-horizontal whorls. CSV ref: 小葉欖仁 θ:85-90 r:0.5; 黑板樹 θ:90 r:0.6;
// 木棉 θ:80-90 r:0.6 ("similar to 黑板樹 but longer internodes").
const PAGODA_LAYERED: SpeciesRegistryEntry = {
  id: 'pagoda-layered',
  matchPatterns: [
    '小葉欖仁', '欖仁樹', '黑板樹', '木棉', '美人樹', '大葉山欖',
    'terminalia', 'alstonia', 'bombax', 'ceiba', 'chorisia',
  ],
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
    lengthDecay: 0.55,
    angleDeg: 27,
    jitterDeg: 5,
    trunkContraction: 0.90,
    childWidthMin: 0.80,
    childWidthSpan: 0.12,
    maxDepth: 8,
    gravity: 0,
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

// Pyramidal/conical silhouettes: Liquidambar formosana (楓香), Syzygium cumini
// (肯氏蒲桃). Strong central leader with horizontal lateral pairs at vertical
// intervals. CSV ref: 楓香 θ:20-35 r:0.85, 肯氏蒲桃 θ:20-35 r:0.85.
const PYRAMIDAL_CONICAL: SpeciesRegistryEntry = {
  id: 'pyramidal-conical',
  matchPatterns: ['楓香', '肯氏蒲桃', 'liquidambar', 'syzygium'],
  axiom: 'FFFFX',
  iterations: 5,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 0.55, expansion: 'FF[+X][-X]X' },
        { weight: 0.225, expansion: 'FFF[++X]FFX' },
        { weight: 0.225, expansion: 'FFF[--X]FFX' },
      ],
    },
  ],
  walk: {
    initialLength: 10,
    lengthDecay: 0.82,
    angleDeg: 27,
    jitterDeg: 5,
    trunkContraction: 0.85,
    childWidthMin: 0.82,
    childWidthSpan: 0.12,
    maxDepth: 8,
    gravity: 0,
  },
  asset: {
    segmentAspect: 0.95,
    leafSizeScale: 1.0,
  },
  stressResponse: {
    angleDamp: 0.20,
    lengthDamp: 0.20,
    jitterGain: 8,
    iterationDrop: 1,
  },
};

// Vase/rounded crowns: Lagerstroemia speciosa (大花紫薇), Lagerstroemia indica
// (紫薇), Koelreuteria henryi (臺灣欒樹), Sapium sebiferum (烏桕), Fraxinus
// formosana (光蠟樹). Splits early and often, no trunk continuation in the
// dominant variant. CSV ref: 大花紫薇 θ:40-60 r:0.75; 烏桕 θ:40-50 r:0.75;
// 光蠟樹 θ:30-40 r:0.8.
const VASE_SPREADING: SpeciesRegistryEntry = {
  id: 'vase-spreading',
  matchPatterns: [
    '大花紫薇', '紫薇', '臺灣欒樹', '台灣欒樹', '烏桕', '光蠟樹',
    'lagerstroemia', 'koelreuteria', 'sapium', 'fraxinus',
  ],
  axiom: 'FFFX',
  iterations: 5,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 0.40, expansion: 'F[+X][-X]X' },
        { weight: 0.30, expansion: 'F[++X][-X][+X][--X]X' },
        { weight: 0.30, expansion: 'FF[+X][-X]FX' },
      ],
    },
  ],
  walk: {
    initialLength: 9,
    lengthDecay: 0.75,
    angleDeg: 45,
    jitterDeg: 7,
    trunkContraction: 0.85,
    childWidthMin: 0.82,
    childWidthSpan: 0.14,
    maxDepth: 8,
    gravity: 0,
  },
  asset: {
    segmentAspect: 1.0,
    leafSizeScale: 1.10,
  },
  stressResponse: {
    angleDamp: 0.20,
    lengthDamp: 0.18,
    jitterGain: 8,
    iterationDrop: 1,
  },
};

// Monopodial palms: Roystonea regia (大王椰子), Livistona chinensis (蒲葵),
// Phoenix roebelenii (羅比親王海棗). iterations=1, single-variant rule, axiom
// carries the trunk; the rule fans out 5 leaf brackets at the apex.
const PALM_MONOPODIAL: SpeciesRegistryEntry = {
  id: 'palm-monopodial',
  matchPatterns: ['大王椰子', '蒲葵', '羅比親王海棗', 'roystonea', 'livistona', 'phoenix'],
  axiom: 'FFFFFFFFFFX',
  iterations: 1,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 1, expansion: '[++X][+X][X][-X][--X]' },
      ],
    },
  ],
  walk: {
    initialLength: 9,
    lengthDecay: 0.5,
    angleDeg: 30,
    jitterDeg: 4,
    trunkContraction: 1.0,
    childWidthMin: 0.6,
    childWidthSpan: 0.05,
    maxDepth: 8,
    gravity: 0,
  },
  asset: {
    segmentAspect: 0.78,
    leafSizeScale: 1.35,
  },
  stressResponse: {
    angleDamp: 0.10,
    lengthDamp: 0.30,
    jitterGain: 5,
    iterationDrop: 0,
  },
};

// Broad horizontal umbrella: Delonix regia (鳳凰木, royal poinciana), Erythrina
// (黃脈刺桐). Distinct from pagoda-layered by tighter trunk gaps (single-F vs
// FFF) so the canopy reads as one continuous flat-topped umbrella rather than
// stacked tiers. CSV ref: 鳳凰木 θ:70-90 r:0.65; 黃脈刺桐 θ:70-90 r:0.65.
const BROAD_UMBRELLA: SpeciesRegistryEntry = {
  id: 'broad-umbrella',
  matchPatterns: ['鳳凰木', '黃脈刺桐', 'delonix', 'erythrina'],
  axiom: 'FFFX',
  iterations: 5,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 0.45, expansion: 'F[+++X][---X]FX' },
        { weight: 0.30, expansion: 'F[+++X][-X][+X][---X]FX' },
        { weight: 0.25, expansion: 'FF[+++X][---X]X' },
      ],
    },
  ],
  walk: {
    initialLength: 10,
    lengthDecay: 0.65,
    angleDeg: 28,
    jitterDeg: 7,
    trunkContraction: 0.86,
    childWidthMin: 0.82,
    childWidthSpan: 0.13,
    maxDepth: 8,
    gravity: 0,
  },
  asset: {
    segmentAspect: 1.0,
    leafSizeScale: 1.20,
  },
  stressResponse: {
    angleDamp: 0.20,
    lengthDamp: 0.22,
    jitterGain: 9,
    iterationDrop: 1,
  },
};

// Weeping/pendant branches: Cassia fistula (阿勃勒), Ficus benjamina (垂榕),
// Bauhinia × blakeana (豔紫荊). Branches arc earthward over their length via
// the gravity walk-param — the engine extension that absorbed the CSV's "G"
// gravity-parameter notation. CSV ref: 阿勃勒 needs G; 垂榕 strong negative G;
// 豔紫荊 light G.
const WEEPING_PENDANT: SpeciesRegistryEntry = {
  id: 'weeping-pendant',
  matchPatterns: ['阿勃勒', '垂榕', '豔紫荊', 'cassia fistula', 'bauhinia'],
  axiom: 'FFFX',
  iterations: 5,
  rules: [
    {
      symbol: 'X',
      variants: [
        { weight: 0.50, expansion: 'F[+X][-X]FX' },
        { weight: 0.30, expansion: 'F[+X]FF[-X]FX' },
        { weight: 0.20, expansion: 'FF[+X][-X]X' },
      ],
    },
  ],
  walk: {
    initialLength: 10,
    lengthDecay: 0.78,
    angleDeg: 30,
    jitterDeg: 8,
    trunkContraction: 0.90,
    childWidthMin: 0.82,
    childWidthSpan: 0.13,
    maxDepth: 8,
    // ~2.6° earthward bend per F segment — accumulates over branch length so
    // tip segments hang well below their attachment point.
    gravity: 0.045,
  },
  asset: {
    segmentAspect: 0.95,
    leafSizeScale: 1.10,
  },
  stressResponse: {
    angleDamp: 0.15,
    lengthDamp: 0.20,
    jitterGain: 10,
    iterationDrop: 1,
  },
};

export const SPECIES_REGISTRY: SpeciesRegistryEntry[] = [
  SPREADING_BROADLEAF,
  COLUMNAR_NARROW,
  PAGODA_LAYERED,
  PYRAMIDAL_CONICAL,
  VASE_SPREADING,
  PALM_MONOPODIAL,
  BROAD_UMBRELLA,
  WEEPING_PENDANT,
  { ...DEFAULT_SPECIES_CONFIG, matchPatterns: [] },
];

// Boot-time check: a malformed entry crashes the import, not the renderer.
validateRegistry(SPECIES_REGISTRY);
