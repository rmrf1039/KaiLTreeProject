import type { SpeciesConfig } from '../../shared/src/species/types.js';
import { DEFAULT_SPECIES_CONFIG } from '../../shared/src/species/defaults.js';
import { listArchive } from './archive.js';

export type MetaTreeManifest = {
  speciesConfig: SpeciesConfig;
  seed: number;
  leafImageUrls: string[];
  archiveCount: number;
};

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build the meta-tree manifest. The shape (seed + species) replays the most
 * recent contributor's user-tree so the canopy filling with everyone's photos
 * matches the tree the latest participant just admired. Backward compat: if
 * the most recent entry was archived before tree-shape was persisted, fall
 * back to hashing its code through the default species config — same code
 * still produces a deterministic shape.
 */
export function buildMetaTreeManifest(): MetaTreeManifest {
  const recent = listArchive(64);
  const head = recent[0];
  const speciesConfig = head?.speciesConfig ?? DEFAULT_SPECIES_CONFIG;
  const seed = head?.seed ?? (head ? hash32(head.code) : 0);
  return {
    speciesConfig,
    seed,
    leafImageUrls: recent.map((e) => `/proxy/archive-image/${e.id}`),
    archiveCount: recent.length,
  };
}
