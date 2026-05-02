/**
 * Test that the registry validator catches every class of malformed config.
 * For each test case we mutate a clone of a real entry and assert the
 * validator throws with the expected error path. The current registry must
 * also pass cleanly (which it already proves by being importable, but we
 * re-assert for completeness).
 */
import { DEFAULT_SPECIES_CONFIG } from '../shared/src/species/defaults';
import { SPECIES_REGISTRY, type SpeciesRegistryEntry } from '../server/src/species/registry';
import { validateRegistry } from '../server/src/species/validate';

let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// Deep-ish clone of a single entry — we only mutate top-level fields, walk,
// asset, stressResponse, and rule variants, so a one-level spread is enough
// once we also clone the arrays we touch.
function cloneEntry(e: SpeciesRegistryEntry): SpeciesRegistryEntry {
  return {
    ...e,
    walk: { ...e.walk },
    asset: { ...e.asset },
    stressResponse: e.stressResponse ? { ...e.stressResponse } : undefined,
    rules: e.rules.map((r) => ({
      ...r,
      variants: r.variants.map((v) => ({ ...v })),
    })),
    matchPatterns: [...e.matchPatterns],
  };
}

const base = SPECIES_REGISTRY[0]!; // spreading-broadleaf — has stressResponse

function expectThrow(label: string, expectedSubstr: string, mutate: () => SpeciesRegistryEntry[]): void {
  let err: unknown;
  try {
    validateRegistry(mutate());
  } catch (e) {
    err = e;
  }
  if (!err) {
    check(label, false, 'expected throw, got none');
    return;
  }
  const msg = (err as Error).message;
  check(label, msg.includes(expectedSubstr), `got: ${msg}`);
}

// 1. Real registry passes.
{
  let err: unknown;
  try { validateRegistry(SPECIES_REGISTRY); } catch (e) { err = e; }
  check('current SPECIES_REGISTRY validates clean', !err, err ? (err as Error).message : undefined);
}

// 2. Empty registry rejected.
expectThrow('empty registry rejected', 'non-empty array', () => []);

// 3. Duplicate id rejected.
expectThrow('duplicate id rejected', 'duplicate id', () => {
  const a = cloneEntry(base);
  const b = cloneEntry(base);
  return [a, b];
});

// 4. Empty axiom rejected.
expectThrow('empty axiom rejected', 'axiom', () => {
  const e = cloneEntry(base);
  e.axiom = '';
  return [e];
});

// 5. Iterations 0 rejected.
expectThrow('iterations < 1 rejected', 'iterations', () => {
  const e = cloneEntry(base);
  e.iterations = 0;
  return [e];
});

// 6. Iterations far above cap rejected.
expectThrow('iterations above cap rejected', 'iterations', () => {
  const e = cloneEntry(base);
  e.iterations = 99;
  return [e];
});

// 7. Weights summing to !=1 rejected.
expectThrow('weights summing to !=1 rejected', 'weights must sum to 1.0', () => {
  const e = cloneEntry(base);
  e.rules[0]!.variants[0]!.weight = 0.5; // makes total 0.55 + 0.30 + 0.25 = 1.10 ish — actually let me recompute
  return [e];
});

// 8. Negative weight rejected.
expectThrow('negative weight rejected', 'weight', () => {
  const e = cloneEntry(base);
  e.rules[0]!.variants[0]!.weight = -0.5;
  return [e];
});

// 9. Empty variants rejected.
expectThrow('empty variants rejected', 'variants', () => {
  const e = cloneEntry(base);
  e.rules[0]!.variants = [];
  return [e];
});

// 10. Multi-character symbol rejected.
expectThrow('multi-char rule symbol rejected', 'single-character', () => {
  const e = cloneEntry(base);
  e.rules[0]!.symbol = 'XY';
  return [e];
});

// 11. Duplicate rule symbol rejected.
expectThrow('duplicate rule symbol rejected', 'duplicate rule', () => {
  const e = cloneEntry(base);
  e.rules.push({ ...e.rules[0]! });
  return [e];
});

// 12. NaN walk field rejected.
expectThrow('NaN walk.angleDeg rejected', 'angleDeg', () => {
  const e = cloneEntry(base);
  e.walk.angleDeg = Number.NaN;
  return [e];
});

// 13. Negative initialLength rejected.
expectThrow('non-positive initialLength rejected', 'initialLength', () => {
  const e = cloneEntry(base);
  e.walk.initialLength = -5;
  return [e];
});

// 14. childWidthMin out of range rejected.
expectThrow('childWidthMin > 1 rejected', 'childWidthMin', () => {
  const e = cloneEntry(base);
  e.walk.childWidthMin = 1.5;
  return [e];
});

// 15. maxDepth fractional rejected.
expectThrow('maxDepth must be integer', 'maxDepth', () => {
  const e = cloneEntry(base);
  e.walk.maxDepth = 5.5;
  return [e];
});

// 16. Invalid asset.segmentAspect rejected.
expectThrow('non-positive segmentAspect rejected', 'segmentAspect', () => {
  const e = cloneEntry(base);
  e.asset.segmentAspect = 0;
  return [e];
});

// 17. stressResponse.angleDamp > 1 rejected.
expectThrow('angleDamp > 1 rejected', 'angleDamp', () => {
  const e = cloneEntry(base);
  e.stressResponse = { angleDamp: 2, lengthDamp: 0.2, jitterGain: 8, iterationDrop: 1 };
  return [e];
});

// 18. Negative stressResponse field rejected.
expectThrow('negative jitterGain rejected', 'jitterGain', () => {
  const e = cloneEntry(base);
  e.stressResponse = { angleDamp: 0.2, lengthDamp: 0.2, jitterGain: -1, iterationDrop: 1 };
  return [e];
});

// 19. Empty matchPattern rejected.
expectThrow('empty matchPattern rejected', 'matchPatterns', () => {
  const e = cloneEntry(base);
  e.matchPatterns = ['valid', ''];
  return [e];
});

// 20. Default config wrapped with empty matchPatterns is valid.
{
  let err: unknown;
  try {
    validateRegistry([{ ...DEFAULT_SPECIES_CONFIG, matchPatterns: [] }]);
  } catch (e) { err = e; }
  check('default-only registry validates clean', !err);
}

if (failed > 0) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log(`\nall checks pass`);
