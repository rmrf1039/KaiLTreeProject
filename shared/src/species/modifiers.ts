import type { Modifiers, SpeciesConfig } from './types.js';

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

// Pure config-to-config transform. Composable by design — apply more
// modifiers later by calling further `apply*` functions on the result.
//
// Identity is preserved when:
//   - `mods` is undefined or has no recognized fields, OR
//   - effective stress is 0, OR
//   - the species opts out by omitting `stressResponse`.
//
// This guarantees default-species output is byte-identical regardless of
// what stress signal the server happens to compute.
export function applyModifiers(
  cfg: SpeciesConfig,
  mods: Modifiers | undefined,
): SpeciesConfig {
  if (!mods) return cfg;
  const s = clamp(mods.stress ?? 0, 0, 1);
  if (s === 0 || !cfg.stressResponse) return cfg;
  const r = cfg.stressResponse;
  return {
    ...cfg,
    iterations: Math.max(1, cfg.iterations - Math.floor(s * r.iterationDrop)),
    walk: {
      ...cfg.walk,
      angleDeg: cfg.walk.angleDeg * (1 - s * r.angleDamp),
      initialLength: cfg.walk.initialLength * (1 - s * r.lengthDamp),
      jitterDeg: cfg.walk.jitterDeg + s * r.jitterGain,
    },
  };
}
