import type { SpeciesConfig } from '../../../shared/src/species/types.js';
import { DEFAULT_SPECIES_CONFIG } from '../../../shared/src/species/defaults.js';

export type SpeciesRegistryEntry = SpeciesConfig & {
  // Substrings (lowercased) that, if found in the CSV `treeType` column,
  // map that record to this config. Stripped before transmission.
  matchPatterns: string[];
};

// Phase 1 ships a registry of one. Phase 2 will populate this from JSON files
// under `server/data/species/`.
export const SPECIES_REGISTRY: SpeciesRegistryEntry[] = [
  { ...DEFAULT_SPECIES_CONFIG, matchPatterns: [] },
];
