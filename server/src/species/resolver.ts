import type { SpeciesConfig } from '../../../shared/src/species/types.js';
import { DEFAULT_SPECIES_CONFIG } from '../../../shared/src/species/defaults.js';
import { SPECIES_REGISTRY, type SpeciesRegistryEntry } from './registry.js';

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim();
}

function strip(entry: SpeciesRegistryEntry): SpeciesConfig {
  const { matchPatterns: _matchPatterns, ...rest } = entry;
  return rest;
}

export function resolveSpecies(treeType: string): SpeciesConfig {
  const norm = normalize(treeType);
  if (norm) {
    for (const entry of SPECIES_REGISTRY) {
      if (entry.matchPatterns.some((p) => norm.includes(normalize(p)))) {
        return strip(entry);
      }
    }
  }
  return DEFAULT_SPECIES_CONFIG;
}
