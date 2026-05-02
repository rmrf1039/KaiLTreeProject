/**
 * End-to-end test for the diameter-z-score stress signal. Loads the real
 * registry CSV, samples records, and asserts properties of the resulting
 * Modifiers without depending on specific numeric values that would drift
 * with each registry refresh.
 */
import { applyModifiers } from '../shared/src/species/modifiers';
import { resolveSpecies } from '../server/src/species/resolver';
import { loadRegistry, getRecords } from '../server/src/registry';
import { computeModifiers, getSpeciesStats } from '../server/src/species/stress';

let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

loadRegistry();
const records = getRecords();

// 1. Pre-registry: a fresh process imports computeModifiers and calls it
//    before loadRegistry — must gracefully return {} (not throw). Loading
//    happens above so this is just a sanity check that calling on a record
//    whose species has no stats returns {} (rather than NaN/throw).
{
  const fake = { ...records[0]!, treeType: 'NotARealSpecies', diameter: 50, proxyUrl: '' };
  const out = computeModifiers(fake);
  check('unknown species → no modifiers', Object.keys(out).length === 0);
}

// 2. Missing/zero diameter → no modifiers regardless of species. The Taipei
//    dataset uses 0 as a sentinel for missing diameter rather than null.
{
  const r = records.find((x) => x.treeType && (x.diameter === null || x.diameter === 0));
  if (!r) {
    console.log('SKIP no record with null or 0 diameter found');
  } else {
    const out = computeModifiers({ ...r, proxyUrl: '' });
    check(
      `${r.diameter === null ? 'null' : 'zero'} diameter → no modifiers`,
      Object.keys(out).length === 0,
    );
  }
}

// 3. Pick a high-volume species and verify thin records have higher stress
//    than thick records. Using 榕樹 (Ficus) which has 11k+ rows.
{
  const target = '榕樹';
  const stats = getSpeciesStats(target);
  if (!stats) {
    check(`stats present for ${target}`, false);
  } else {
    console.log(`     ${target} stats: mean=${stats.mean.toFixed(1)}cm stddev=${stats.stddev.toFixed(1)} n=${stats.count}`);
    const same = records.filter((r) => r.treeType === target && r.diameter !== null && r.diameter > 0);
    same.sort((a, b) => (a.diameter ?? 0) - (b.diameter ?? 0));
    const thinnest = same[0]!;
    const thickest = same[same.length - 1]!;
    const median = same[Math.floor(same.length / 2)]!;

    const sThin = computeModifiers({ ...thinnest, proxyUrl: '' }).stress ?? 0;
    const sMedian = computeModifiers({ ...median, proxyUrl: '' }).stress ?? 0;
    const sThick = computeModifiers({ ...thickest, proxyUrl: '' }).stress ?? 0;

    check(
      `thinnest ${target} (∅ ${thinnest.diameter}cm) gets stress > 0`,
      sThin > 0,
      `stress=${sThin.toFixed(3)}`,
    );
    check(
      `thickest ${target} (∅ ${thickest.diameter}cm) gets stress = 0`,
      sThick === 0,
    );
    check(
      `stress decreases with diameter (thin > median ≥ thick)`,
      sThin > sMedian && sMedian >= sThick,
      `thin=${sThin.toFixed(3)} median=${sMedian.toFixed(3)} thick=${sThick.toFixed(3)}`,
    );
    check('stress is bounded in [0,1]', sThin >= 0 && sThin <= 1 && sMedian >= 0 && sMedian <= 1);
  }
}

// 4. End-to-end: applyModifiers(resolveSpecies(...), computeModifiers(...))
//    on a stressed Ficus record produces a config with damped angle and
//    raised jitter relative to the unstressed config. On a default-species
//    (e.g. 楓香, no stressResponse) the same pipeline returns identity.
{
  const ficusRecords = records
    .filter((r) => r.treeType === '榕樹' && r.diameter !== null && r.diameter > 0)
    .sort((a, b) => (a.diameter ?? 0) - (b.diameter ?? 0));
  const stressedFicus = ficusRecords[0]!;
  const baseFicus = resolveSpecies(stressedFicus.treeType);
  const modFicus = applyModifiers(baseFicus, computeModifiers({ ...stressedFicus, proxyUrl: '' }));
  check(
    'stressed Ficus: angleDeg < base',
    modFicus.walk.angleDeg < baseFicus.walk.angleDeg,
    `${baseFicus.walk.angleDeg} → ${modFicus.walk.angleDeg.toFixed(2)}`,
  );
  check(
    'stressed Ficus: jitterDeg > base',
    modFicus.walk.jitterDeg > baseFicus.walk.jitterDeg,
    `${baseFicus.walk.jitterDeg} → ${modFicus.walk.jitterDeg.toFixed(2)}`,
  );

  const fengxiang = records.find((r) => r.treeType === '楓香' && r.diameter !== null && r.diameter > 0);
  if (fengxiang) {
    const baseDefault = resolveSpecies(fengxiang.treeType);
    const modDefault = applyModifiers(baseDefault, computeModifiers({ ...fengxiang, proxyUrl: '' }));
    check(
      'default species (楓香) is unchanged by modifiers',
      modDefault === baseDefault,
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log(`\nall checks pass`);
