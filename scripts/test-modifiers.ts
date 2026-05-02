/**
 * Smoke test for the modifiers transform pipeline. Validates the identity
 * cases that protect zero-delta and the active cases that prove the
 * transform actually moves the config.
 */
import { DEFAULT_SPECIES_CONFIG } from '../shared/src/species/defaults';
import { applyModifiers } from '../shared/src/species/modifiers';
import { resolveSpecies } from '../server/src/species/resolver';

let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

const spreading = resolveSpecies('榕樹');

// 1. Identity at stress=0 for a stress-equipped species.
{
  const out = applyModifiers(spreading, { stress: 0 });
  check(
    'stress=0 returns input unchanged (spreading)',
    out === spreading,
  );
}

// 2. Identity for default config at non-zero stress (no stressResponse).
{
  const out = applyModifiers(DEFAULT_SPECIES_CONFIG, { stress: 0.5 });
  check(
    'stress=0.5 on default returns input unchanged (no stressResponse)',
    out === DEFAULT_SPECIES_CONFIG,
  );
}

// 3. Identity when modifiers undefined.
{
  const out = applyModifiers(spreading, undefined);
  check('undefined modifiers returns input unchanged', out === spreading);
}

// 4. Effect at stress=0.5 on a stress-equipped species.
{
  const stressed = applyModifiers(spreading, { stress: 0.5 });
  check(
    'angleDeg shrinks under stress',
    stressed.walk.angleDeg < spreading.walk.angleDeg,
    `${spreading.walk.angleDeg} → ${stressed.walk.angleDeg}`,
  );
  check(
    'initialLength shrinks under stress',
    stressed.walk.initialLength < spreading.walk.initialLength,
    `${spreading.walk.initialLength} → ${stressed.walk.initialLength}`,
  );
  check(
    'jitterDeg grows under stress',
    stressed.walk.jitterDeg > spreading.walk.jitterDeg,
    `${spreading.walk.jitterDeg} → ${stressed.walk.jitterDeg}`,
  );
  check(
    'rules and asset pass through unchanged',
    stressed.rules === spreading.rules && stressed.asset === spreading.asset,
  );
}

// 5. Out-of-range stress is clamped (not NaN'd or thrown).
{
  const aboveOne = applyModifiers(spreading, { stress: 5 });
  const negative = applyModifiers(spreading, { stress: -1 });
  // negative clamps to 0 → identity
  check('negative stress clamps to identity', negative === spreading);
  // above-one clamps to 1 — angle should hit the (1 - 1*angleDamp) floor
  const expectedAngle = spreading.walk.angleDeg * (1 - spreading.stressResponse!.angleDamp);
  check(
    'stress > 1 clamps to 1',
    Math.abs(aboveOne.walk.angleDeg - expectedAngle) < 1e-9,
    `expected ${expectedAngle}, got ${aboveOne.walk.angleDeg}`,
  );
}

// 6. iterations are clamped to >= 1.
{
  const cfgWithBigDrop = {
    ...spreading,
    iterations: 1,
    stressResponse: { ...spreading.stressResponse!, iterationDrop: 99 },
  };
  const stressed = applyModifiers(cfgWithBigDrop, { stress: 1 });
  check('iterations clamps to >= 1', stressed.iterations >= 1, `got ${stressed.iterations}`);
}

if (failed > 0) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log(`\nall checks pass`);
