import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const DRIVE_FILE_ID = '1ontxB8mgs0BHoW0ha5mJ5DWpGedQsz3O';
const DRIVE_URL = `https://drive.google.com/uc?export=download&id=${DRIVE_FILE_ID}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(REPO_ROOT, 'server/data');
const CSV_PATH = path.resolve(DATA_DIR, 'tree_registry.csv');
const META_PATH = path.resolve(DATA_DIR, 'tree_registry.meta.json');

type Row = Record<string, string>;

async function fetchCsv(): Promise<string> {
  process.stdout.write(`Fetching ${DRIVE_URL}\n`);
  const res = await fetch(DRIVE_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error(
      'Drive returned HTML, not CSV. The file may require a confirmation token (too large) or may be private. ' +
        'Open the Drive URL manually, download, and place the CSV at ' +
        path.relative(REPO_ROOT, CSV_PATH)
    );
  }
  return text;
}

function normalize(rows: Row[]): Row[] {
  const out = rows
    .filter((r) => r && String(r.TreeID ?? '').trim() !== '' && String(r.Dist ?? '').trim() !== '')
    .map((r) => ({ ...r, TreeID: String(r.TreeID).trim(), Dist: String(r.Dist).trim() }));
  out.sort((a, b) => {
    const ad = a.Dist!;
    const bd = b.Dist!;
    if (ad !== bd) return ad < bd ? -1 : 1;
    const at = a.TreeID!;
    const bt = b.TreeID!;
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  return out;
}

async function main(): Promise<void> {
  const raw = await fetchCsv();
  const parsed = Papa.parse<Row>(raw, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    console.warn(`Parser emitted ${parsed.errors.length} warnings (first: ${parsed.errors[0]?.message})`);
  }
  const cols = parsed.meta.fields ?? [];
  if (!cols.includes('TreeID') || !cols.includes('Dist')) {
    throw new Error(`CSV missing required columns TreeID/Dist. Found: ${cols.join(', ')}`);
  }
  const rows = normalize(parsed.data);
  if (rows.length === 0) throw new Error('No valid rows after normalization.');

  const outCsv = Papa.unparse(rows, { columns: cols });
  const sha256 = crypto.createHash('sha256').update(outCsv).digest('hex');

  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${CSV_PATH}.tmp`;
  await fs.writeFile(tmp, outCsv, 'utf8');
  await fs.rename(tmp, CSV_PATH);

  await fs.writeFile(
    META_PATH,
    JSON.stringify(
      {
        rowCount: rows.length,
        columns: cols,
        sha256,
        fetchedAt: new Date().toISOString(),
        sourceUrl: DRIVE_URL,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`✓ Wrote ${rows.length} records → ${path.relative(REPO_ROOT, CSV_PATH)}`);
  console.log(`  sha256: ${sha256}`);
}

main().catch((err) => {
  console.error('✗ refresh-registry failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
