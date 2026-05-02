import type { SpeciesConfig } from '../../../shared/src/species/types.js';
import type { SpeciesRegistryEntry } from './registry.js';

// Boot-time validator. Catches the value-level constraints TypeScript can't
// express: weights summing, finite numbers, positive ranges, uniqueness.
//
// Throws on the first failure with a path that pinpoints the offending entry
// and field, so a typo in a JSON edit fails loud at server start instead of
// rendering a silently-broken tree.

const WEIGHT_TOLERANCE = 1e-6;
// Loose engine-side absolute caps. Configs requesting more than this are
// almost certainly typos — the real engine limits in `CAPS` (client-side)
// will clamp anyway.
const MAX_ITERATIONS = 12;
const MAX_DEPTH_HARD = 16;

class RegistryError extends Error {
  constructor(path: string, msg: string) {
    super(`registry validation failed at ${path}: ${msg}`);
    this.name = 'RegistryError';
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateWalk(path: string, walk: SpeciesConfig['walk']): void {
  const fields: Array<keyof typeof walk> = [
    'initialLength', 'lengthDecay', 'angleDeg', 'jitterDeg',
    'trunkContraction', 'childWidthMin', 'childWidthSpan', 'maxDepth',
  ];
  for (const f of fields) {
    if (!isFiniteNumber(walk[f])) throw new RegistryError(`${path}.${f}`, 'must be a finite number');
  }
  if (walk.initialLength <= 0) throw new RegistryError(`${path}.initialLength`, 'must be > 0');
  if (walk.lengthDecay <= 0 || walk.lengthDecay > 2) throw new RegistryError(`${path}.lengthDecay`, 'must be in (0, 2]');
  if (walk.angleDeg < 0) throw new RegistryError(`${path}.angleDeg`, 'must be ≥ 0');
  if (walk.jitterDeg < 0) throw new RegistryError(`${path}.jitterDeg`, 'must be ≥ 0');
  if (walk.trunkContraction <= 0 || walk.trunkContraction > 2) throw new RegistryError(`${path}.trunkContraction`, 'must be in (0, 2]');
  if (walk.childWidthMin <= 0 || walk.childWidthMin > 1) throw new RegistryError(`${path}.childWidthMin`, 'must be in (0, 1]');
  if (walk.childWidthSpan < 0) throw new RegistryError(`${path}.childWidthSpan`, 'must be ≥ 0');
  if (walk.childWidthMin + walk.childWidthSpan > 1.5) throw new RegistryError(`${path}.childWidth`, 'min+span exceeds 1.5 — children would be wider than parents');
  if (!Number.isInteger(walk.maxDepth) || walk.maxDepth < 0 || walk.maxDepth > MAX_DEPTH_HARD) {
    throw new RegistryError(`${path}.maxDepth`, `must be an integer in [0, ${MAX_DEPTH_HARD}]`);
  }
}

function validateAsset(path: string, asset: SpeciesConfig['asset']): void {
  if (!isFiniteNumber(asset.segmentAspect) || asset.segmentAspect <= 0) {
    throw new RegistryError(`${path}.segmentAspect`, 'must be a positive finite number');
  }
  if (!isFiniteNumber(asset.leafSizeScale) || asset.leafSizeScale <= 0) {
    throw new RegistryError(`${path}.leafSizeScale`, 'must be a positive finite number');
  }
}

function validateStressResponse(path: string, sr: NonNullable<SpeciesConfig['stressResponse']>): void {
  const fields: Array<keyof typeof sr> = ['angleDamp', 'lengthDamp', 'jitterGain', 'iterationDrop'];
  for (const f of fields) {
    if (!isFiniteNumber(sr[f])) throw new RegistryError(`${path}.${f}`, 'must be a finite number');
    if (sr[f] < 0) throw new RegistryError(`${path}.${f}`, 'must be ≥ 0');
  }
  if (sr.angleDamp > 1) throw new RegistryError(`${path}.angleDamp`, 'must be ≤ 1');
  if (sr.lengthDamp > 1) throw new RegistryError(`${path}.lengthDamp`, 'must be ≤ 1');
  if (!Number.isInteger(sr.iterationDrop)) throw new RegistryError(`${path}.iterationDrop`, 'must be an integer');
}

function validateEntry(idx: number, entry: SpeciesRegistryEntry): void {
  const path = `entries[${idx}]`;

  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    throw new RegistryError(`${path}.id`, 'must be a non-empty string');
  }
  if (typeof entry.axiom !== 'string' || entry.axiom.length === 0) {
    throw new RegistryError(`${path}.axiom`, 'must be a non-empty string');
  }
  if (!Number.isInteger(entry.iterations) || entry.iterations < 1 || entry.iterations > MAX_ITERATIONS) {
    throw new RegistryError(`${path}.iterations`, `must be an integer in [1, ${MAX_ITERATIONS}]`);
  }

  if (!Array.isArray(entry.rules)) {
    throw new RegistryError(`${path}.rules`, 'must be an array');
  }
  const seenSymbols = new Set<string>();
  for (let r = 0; r < entry.rules.length; r++) {
    const rule = entry.rules[r]!;
    const rPath = `${path}.rules[${r}]`;
    if (typeof rule.symbol !== 'string' || rule.symbol.length !== 1) {
      throw new RegistryError(`${rPath}.symbol`, 'must be a single-character string');
    }
    if (seenSymbols.has(rule.symbol)) {
      throw new RegistryError(`${rPath}.symbol`, `duplicate rule for symbol "${rule.symbol}"`);
    }
    seenSymbols.add(rule.symbol);
    if (!Array.isArray(rule.variants) || rule.variants.length === 0) {
      throw new RegistryError(`${rPath}.variants`, 'must be a non-empty array');
    }
    let weightSum = 0;
    for (let v = 0; v < rule.variants.length; v++) {
      const variant = rule.variants[v]!;
      const vPath = `${rPath}.variants[${v}]`;
      if (!isFiniteNumber(variant.weight) || variant.weight <= 0) {
        throw new RegistryError(`${vPath}.weight`, 'must be a positive finite number');
      }
      if (typeof variant.expansion !== 'string' || variant.expansion.length === 0) {
        throw new RegistryError(`${vPath}.expansion`, 'must be a non-empty string');
      }
      weightSum += variant.weight;
    }
    if (Math.abs(weightSum - 1) > WEIGHT_TOLERANCE) {
      throw new RegistryError(
        `${rPath}.variants`,
        `weights must sum to 1.0 (got ${weightSum.toFixed(6)})`,
      );
    }
  }

  validateWalk(`${path}.walk`, entry.walk);
  validateAsset(`${path}.asset`, entry.asset);
  if (entry.stressResponse) {
    validateStressResponse(`${path}.stressResponse`, entry.stressResponse);
  }

  if (!Array.isArray(entry.matchPatterns)) {
    throw new RegistryError(`${path}.matchPatterns`, 'must be an array');
  }
  for (let m = 0; m < entry.matchPatterns.length; m++) {
    const p = entry.matchPatterns[m]!;
    if (typeof p !== 'string' || p.length === 0) {
      throw new RegistryError(`${path}.matchPatterns[${m}]`, 'must be a non-empty string');
    }
  }
}

export function validateRegistry(entries: SpeciesRegistryEntry[]): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new RegistryError('entries', 'registry must be a non-empty array');
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    validateEntry(i, entry);
    if (seenIds.has(entry.id)) {
      throw new RegistryError(`entries[${i}].id`, `duplicate id "${entry.id}"`);
    }
    seenIds.add(entry.id);
  }
}
