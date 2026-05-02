import type { Modifiers } from '../../../shared/src/species/types.js';
import type { TreeRecord } from '../../../shared/src/types.js';

// Phase 5 stub: returns no stress for now. Real stress signals (diameter
// percentile vs species norms, district density, survey age) plug in here
// as deterministic, side-effect-free derivations.
//
// Keep this pure: same record → same Modifiers, no clock or RNG reads.
export function computeModifiers(record: TreeRecord | undefined): Modifiers {
  void record;
  return {};
}
