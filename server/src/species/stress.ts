import type { Modifiers } from '../../../shared/src/species/types.js';
import type { TreeRecord } from '../../../shared/src/types.js';
import { getRecords, type RegistryRecord } from '../registry.js';

// Phase 5 V1 stress signal: anomalously thin diameter relative to per-species
// norms. The intuition is that an urban tree forced to grow tall and narrow
// (or stunted by root constraints) will show up in the diameter distribution
// as a record well below its species' mean.
//
// Design constraints:
//   - Pure and deterministic: same record + same registry → same stress.
//   - Lazy: tolerates being called before the registry is loaded.
//   - Self-contained: no external services, no clock reads.
//
// The signal is intentionally one-sided. A tree above the species mean is
// not considered "more stressed than average" — it's healthy or large, both
// of which read as `stress = 0`.

type SpeciesStats = {
  mean: number;
  stddev: number;
  count: number;
};

const MIN_SAMPLE = 10;
// z-score (-Z_FLOOR) clamps to stress = 1.0. Three standard deviations below
// the mean is the maximum-stress floor — beyond which all trees pile up at 1.
const Z_FLOOR = 3;

let stats: Map<string, SpeciesStats> | null = null;

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim();
}

function tryLoadStats(): Map<string, SpeciesStats> | null {
  if (stats) return stats;
  let records: ReadonlyArray<RegistryRecord>;
  try {
    records = getRecords();
  } catch {
    return null;
  }
  const groups = new Map<string, number[]>();
  for (const r of records) {
    if (r.diameter === null || r.diameter <= 0) continue;
    const key = normalize(r.treeType);
    if (!key) continue;
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(r.diameter);
  }
  const out = new Map<string, SpeciesStats>();
  for (const [key, vals] of groups) {
    if (vals.length < MIN_SAMPLE) continue;
    let sum = 0;
    for (const v of vals) sum += v;
    const mean = sum / vals.length;
    let sqsum = 0;
    for (const v of vals) sqsum += (v - mean) * (v - mean);
    const stddev = Math.sqrt(sqsum / vals.length);
    if (stddev <= 0) continue;
    out.set(key, { mean, stddev, count: vals.length });
  }
  stats = out;
  return stats;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export function computeModifiers(record: TreeRecord | undefined): Modifiers {
  if (!record || record.diameter === null || record.diameter <= 0) return {};
  const loaded = tryLoadStats();
  if (!loaded) return {};
  const key = normalize(record.treeType);
  const s = loaded.get(key);
  if (!s) return {};
  const z = (record.diameter - s.mean) / s.stddev;
  if (z >= 0) return {};
  const stress = clamp(-z / Z_FLOOR, 0, 1);
  if (stress === 0) return {};
  return { stress };
}

// Test/debug accessor — exposes per-species stats for verification scripts.
// Not used at runtime.
export function getSpeciesStats(treeType: string): SpeciesStats | undefined {
  return tryLoadStats()?.get(normalize(treeType));
}
