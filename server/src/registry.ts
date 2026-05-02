import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, '../data/tree_registry.csv');
const META_PATH = path.resolve(__dirname, '../data/tree_registry.meta.json');

export type RegistryRecord = {
  treeId: string;
  dist: string;
  region: string;
  regionRemark: string;
  treeType: string;
  diameter: number | null;
  treeHeight: number | null;
  surveyDate: string;
  twd97x: number | null;
  twd97y: number | null;
};

function parseNum(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type RegistryMeta = {
  rowCount: number;
  columns: string[];
  sha256: string;
  fetchedAt: string;
  sourceUrl: string;
};

let records: RegistryRecord[] | null = null;
let meta: RegistryMeta | null = null;

export function loadRegistry(): { records: RegistryRecord[]; meta: RegistryMeta } {
  if (records && meta) return { records, meta };

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `Registry CSV not found at ${CSV_PATH}. Run "npm run refresh-registry" to populate it.`
    );
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true });
  const rows = parsed.data
    .filter((r) => r.TreeID && r.Dist)
    .map<RegistryRecord>((r) => ({
      treeId: String(r.TreeID).trim(),
      dist: String(r.Dist).trim(),
      region: String(r.Region ?? '').trim(),
      regionRemark: String(r.RegionRemark ?? '').trim(),
      treeType: String(r.TreeType ?? '').trim(),
      diameter: parseNum(r.Diameter),
      treeHeight: parseNum(r.TreeHeight),
      surveyDate: String(r.SurveyDate ?? '').trim(),
      twd97x: parseNum(r.TWD97X),
      twd97y: parseNum(r.TWD97Y),
    }));
  rows.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist < b.dist ? -1 : 1;
    return a.treeId < b.treeId ? -1 : a.treeId > b.treeId ? 1 : 0;
  });

  const metaRaw = fs.existsSync(META_PATH)
    ? (JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as RegistryMeta)
    : {
        rowCount: rows.length,
        columns: parsed.meta.fields ?? [],
        sha256: '',
        fetchedAt: '',
        sourceUrl: '',
      };

  records = rows;
  meta = metaRaw;
  return { records, meta };
}

export function getRecords(): RegistryRecord[] {
  if (!records) throw new Error('Registry not loaded. Call loadRegistry() first.');
  return records;
}

export function recordCount(): number {
  return records?.length ?? 0;
}

export function getMeta(): RegistryMeta {
  if (!meta) throw new Error('Registry not loaded. Call loadRegistry() first.');
  return meta;
}
