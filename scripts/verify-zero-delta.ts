/**
 * Zero-delta regression guard for the Phase 1 species-config seam migration.
 *
 * Captures SHA-256 hashes of `expand`'s output string and `walk`'s six geometry
 * arrays for a fixed set of seeds. Run with `--capture` to write a baseline,
 * run without to compare the current engine output against the saved baseline.
 *
 * The script is written to call `expand`/`walk` through a thin adapter so it
 * can be flipped from pre-refactor to post-refactor signatures by editing
 * `runEngine` only.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expand } from '../client/src/lsystem/grammar';
import { walk } from '../client/src/lsystem/turtle';
import { DEFAULT_SPECIES_CONFIG } from '../shared/src/species/defaults';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.resolve(__dirname, 'zero-delta-baseline.json');

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const CODES = ['0000', '0001', '1234', '9999', '4242'];

const ATLAS_META = { atlasSlots: 9, variantsPerSlot: 12 };

function runEngine(seed: number): { str: string; iterations: number; geom: ReturnType<typeof walk> } {
  const { str, iterations } = expand(DEFAULT_SPECIES_CONFIG, seed);
  const geom = walk(str, seed, DEFAULT_SPECIES_CONFIG.walk, ATLAS_META);
  return { str, iterations, geom };
}

type SeedResult = {
  code: string;
  seed: number;
  iterations: number;
  stringLength: number;
  stringSha: string;
  segmentCount: number;
  leafCount: number;
  branchCount: number;
  segmentsSha: string;
  leavesSha: string;
  branchParentsSha: string;
  branchOriginXSha: string;
  branchOriginYSha: string;
  branchDepthSha: string;
};

function sha256(buf: Uint8Array | string): string {
  const h = crypto.createHash('sha256');
  if (typeof buf === 'string') h.update(buf);
  else h.update(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  return h.digest('hex');
}

function runOne(code: string): SeedResult {
  const seed = fnv1a32(code);
  const { str, iterations, geom } = runEngine(seed);
  return {
    code,
    seed,
    iterations,
    stringLength: str.length,
    stringSha: sha256(str),
    segmentCount: geom.segmentCount,
    leafCount: geom.leafCount,
    branchCount: geom.branchCount,
    segmentsSha: sha256(geom.segments),
    leavesSha: sha256(geom.leaves),
    branchParentsSha: sha256(geom.branchParents),
    branchOriginXSha: sha256(geom.branchOriginX),
    branchOriginYSha: sha256(geom.branchOriginY),
    branchDepthSha: sha256(geom.branchDepth),
  };
}

function main(): void {
  const capture = process.argv.includes('--capture');
  const results: SeedResult[] = CODES.map(runOne);

  if (capture) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2));
    console.log(`[zero-delta] captured baseline for ${results.length} seeds → ${BASELINE_PATH}`);
    for (const r of results) {
      console.log(`  ${r.code} seed=${r.seed} str.len=${r.stringLength} segs=${r.segmentCount} leaves=${r.leafCount} branches=${r.branchCount}`);
    }
    return;
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`[zero-delta] no baseline at ${BASELINE_PATH}; run with --capture first`);
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as SeedResult[];
  const byCode = new Map(baseline.map((r) => [r.code, r]));

  let failed = 0;
  const fields: Array<keyof SeedResult> = [
    'iterations',
    'stringLength',
    'stringSha',
    'segmentCount',
    'leafCount',
    'branchCount',
    'segmentsSha',
    'leavesSha',
    'branchParentsSha',
    'branchOriginXSha',
    'branchOriginYSha',
    'branchDepthSha',
  ];
  for (const r of results) {
    const b = byCode.get(r.code);
    if (!b) {
      console.error(`[zero-delta] FAIL ${r.code}: missing from baseline`);
      failed++;
      continue;
    }
    const diffs: string[] = [];
    for (const f of fields) {
      if (r[f] !== b[f]) diffs.push(`${f}: ${b[f]} → ${r[f]}`);
    }
    if (diffs.length === 0) {
      console.log(`[zero-delta] OK   ${r.code} (seed=${r.seed})`);
    } else {
      console.error(`[zero-delta] FAIL ${r.code} (seed=${r.seed}):`);
      for (const d of diffs) console.error(`    ${d}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`[zero-delta] ${failed}/${results.length} seeds diverged from baseline`);
    process.exit(1);
  }
  console.log(`[zero-delta] all ${results.length} seeds match baseline`);
}

main();
