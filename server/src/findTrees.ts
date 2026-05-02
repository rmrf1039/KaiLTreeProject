import type { SearchFailureReason, TreeRecord } from '../../shared/src/types.js';
import { type RegistryRecord, getRecords } from './registry.js';

const SEARCH_RANGE = 80;
const NEEDED = 9;
const MIN_ACCEPTABLE = 3;
const POOL = 6;
const REQ_TIMEOUT_MS = 1500;
const BUDGET_MS = 8000;

export class LookupError extends Error {
  constructor(public reason: SearchFailureReason) {
    super(reason);
    this.name = 'LookupError';
  }
}

export function upstreamUrl(rec: RegistryRecord): string {
  return `https://geopkl.gov.taipei/images/commonTree/${encodeURIComponent(rec.dist)}/${encodeURIComponent(
    rec.treeId,
  )}.jpg`;
}

function toTreeRecord(rec: RegistryRecord): TreeRecord {
  return {
    treeId: rec.treeId,
    dist: rec.dist,
    region: rec.region,
    regionRemark: rec.regionRemark,
    treeType: rec.treeType,
    diameter: rec.diameter,
    treeHeight: rec.treeHeight,
    surveyDate: rec.surveyDate,
    twd97x: rec.twd97x,
    twd97y: rec.twd97y,
    proxyUrl: `/proxy/tree-image/${encodeURIComponent(rec.dist)}/${encodeURIComponent(rec.treeId)}.jpg`,
  };
}

async function headCheck(url: string, signal: AbortSignal): Promise<boolean> {
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onOuterAbort);
  }
}

export type FindProgress = (checked: number, found: number) => void;

export async function findTrees(
  code: string,
  signal: AbortSignal,
  onProgress?: FindProgress,
): Promise<TreeRecord[]> {
  if (!/^\d{4}$/.test(code)) throw new LookupError('invalid-code');

  const records = getRecords();
  if (records.length === 0) throw new LookupError('insufficient-photos');

  const idx0 = Number.parseInt(code, 10) % records.length;
  const candidates: RegistryRecord[] = [];
  for (let offset = -SEARCH_RANGE; offset <= SEARCH_RANGE; offset++) {
    const idx = ((idx0 + offset) % records.length + records.length) % records.length;
    candidates.push(records[idx]!);
  }

  const results: (boolean | undefined)[] = new Array(candidates.length);
  const innerAbort = new AbortController();
  const onOuterAbort = () => innerAbort.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });
  const budgetTimer = setTimeout(() => innerAbort.abort(), BUDGET_MS);

  // Condition-variable pattern: each worker resolves then swaps in a fresh promise.
  let resolveNotify!: () => void;
  let notify = new Promise<void>((r) => (resolveNotify = r));
  const signalChange = () => {
    const prior = resolveNotify;
    notify = new Promise<void>((r) => (resolveNotify = r));
    prior();
  };

  let queueIdx = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < POOL; w++) {
    workers.push(
      (async () => {
        while (!innerAbort.signal.aborted) {
          const i = queueIdx++;
          if (i >= candidates.length) return;
          try {
            results[i] = await headCheck(upstreamUrl(candidates[i]!), innerAbort.signal);
          } catch {
            results[i] = false;
          }
          signalChange();
        }
      })(),
    );
  }

  try {
    let cursor = 0;
    const hits: TreeRecord[] = [];
    while (cursor < candidates.length && hits.length < NEEDED) {
      if (innerAbort.signal.aborted) break;
      if (results[cursor] === undefined) {
        await notify;
        continue;
      }
      if (results[cursor]) hits.push(toTreeRecord(candidates[cursor]!));
      cursor++;
      onProgress?.(cursor, hits.length);
    }

    innerAbort.abort();
    await Promise.allSettled(workers);

    if (signal.aborted) throw new LookupError('canceled');
    if (hits.length === 0 && cursor < candidates.length) {
      throw new LookupError('timeout');
    }
    if (hits.length < MIN_ACCEPTABLE) throw new LookupError('insufficient-photos');
    return hits;
  } finally {
    clearTimeout(budgetTimer);
    signal.removeEventListener('abort', onOuterAbort);
    innerAbort.abort();
  }
}
