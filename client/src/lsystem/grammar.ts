import type { ProductionRule, SpeciesConfig } from '../../../shared/src/species/types';
import { Xorshift32 } from './rng';

// Engine-level resource caps. CAPS clamps config values; CAPS is never on the wire.
// `iterations` is a species property — not capped here.
export const CAPS = {
  maxStringLength: 10_000,
  maxSegments: 500,
  maxLeaves: 160,
  maxDepth: 8,
} as const;

type CompiledRule = {
  // Cumulative weight thresholds, normalized so the last entry is 1.0.
  thresholds: number[];
  expansions: string[];
};

// Build the cumulative-weight lookup once, before any RNG draw, so the inner
// loop spends exactly one rng.next() per matched symbol and zero on misses.
function compileRules(rules: ProductionRule[]): Map<string, CompiledRule> {
  const out = new Map<string, CompiledRule>();
  for (const rule of rules) {
    if (rule.variants.length === 0) continue;
    let total = 0;
    for (const v of rule.variants) total += v.weight;
    if (total <= 0) continue;
    const thresholds: number[] = [];
    const expansions: string[] = [];
    let acc = 0;
    for (const v of rule.variants) {
      acc += v.weight / total;
      thresholds.push(acc);
      expansions.push(v.expansion);
    }
    out.set(rule.symbol, { thresholds, expansions });
  }
  return out;
}

export function expand(
  cfg: Pick<SpeciesConfig, 'axiom' | 'iterations' | 'rules'>,
  seed: number,
): { str: string; iterations: number } {
  const compiled = compileRules(cfg.rules);
  const rng = new Xorshift32(seed);
  let str = cfg.axiom;
  let iter = 0;
  for (iter = 0; iter < cfg.iterations; iter++) {
    let out = '';
    let overflow = false;
    for (let i = 0; i < str.length; i++) {
      if (out.length > CAPS.maxStringLength) {
        overflow = true;
        break;
      }
      const c = str[i]!;
      const rule = compiled.get(c);
      if (!rule) {
        out += c;
        continue;
      }
      const r = rng.next();
      // Pick first cumulative threshold ≥ r; if float fuzz exhausts the table,
      // fall back to the last variant (never identity — that would change strings).
      let pickIdx = rule.expansions.length - 1;
      for (let k = 0; k < rule.thresholds.length; k++) {
        if (r < rule.thresholds[k]!) {
          pickIdx = k;
          break;
        }
      }
      out += rule.expansions[pickIdx]!;
    }
    if (overflow) return { str, iterations: iter };
    str = out;
  }
  return { str, iterations: iter };
}
