import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.resolve(REPO_ROOT, 'server/data/tree_registry.csv');
const CACHE_DIR = path.resolve(REPO_ROOT, 'cache/images');

const TARGET_COUNT = Number(process.env.PREFETCH_COUNT ?? 300);
const POOL = Number(process.env.PREFETCH_POOL ?? 6);
const REQ_TIMEOUT_MS = 8000;
const MAX_BYTES = 10 * 1024 * 1024;

type Record = { treeId: string; dist: string };

function cacheKey(dist: string, treeId: string): string {
  return crypto.createHash('sha256').update(`${dist}/${treeId}`).digest('hex');
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.jpg`);
}

function upstreamUrl(rec: Record): string {
  return `https://geopkl.gov.taipei/images/commonTree/${encodeURIComponent(rec.dist)}/${encodeURIComponent(rec.treeId)}.jpg`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function loadRecords(): Record[] {
  const raw = fssync.readFileSync(CSV_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!);
  const idCol = headers.indexOf('TreeID');
  const distCol = headers.indexOf('Dist');
  if (idCol < 0 || distCol < 0) {
    throw new Error(`Missing TreeID/Dist columns. Found: ${headers.join(',')}`);
  }
  const out: Record[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const treeId = (cells[idCol] ?? '').trim();
    const dist = (cells[distCol] ?? '').trim();
    if (treeId && dist) out.push({ treeId, dist });
  }
  return out;
}

function pickEvenly(records: Record[], n: number): Record[] {
  if (records.length <= n) return records.slice();
  const step = records.length / n;
  const out: Record[] = [];
  for (let i = 0; i < n; i++) out.push(records[Math.floor(i * step)]!);
  return out;
}

async function fetchOne(rec: Record): Promise<'ok' | 'cached' | 'failed'> {
  const cpath = cachePath(cacheKey(rec.dist, rec.treeId));
  if (fssync.existsSync(cpath)) return 'cached';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(upstreamUrl(rec), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) KaiProject/1.0',
        Referer: 'https://geopkl.gov.taipei/',
        Accept: 'image/*',
      },
    });
    if (!res.ok) return 'failed';
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ct.startsWith('image/jpeg')) return 'failed';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES || buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return 'failed';
    }
    const tmp = `${cpath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, cpath);
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const all = loadRecords();
  if (all.length === 0) throw new Error('No registry records.');
  console.log(`Registry has ${all.length} records; targeting ${TARGET_COUNT} cached images.`);

  const candidates = pickEvenly(all, Math.min(TARGET_COUNT * 2, all.length));
  let queueIdx = 0;
  let okCount = 0;
  let cachedCount = 0;
  let failCount = 0;
  let processed = 0;

  const workers: Promise<void>[] = [];
  for (let w = 0; w < POOL; w++) {
    workers.push(
      (async () => {
        while (true) {
          if (okCount + cachedCount >= TARGET_COUNT) return;
          const i = queueIdx++;
          if (i >= candidates.length) return;
          const rec = candidates[i]!;
          const result = await fetchOne(rec);
          processed++;
          if (result === 'ok') okCount++;
          else if (result === 'cached') cachedCount++;
          else failCount++;
          if (processed % 25 === 0) {
            console.log(
              `  [${processed}] ok=${okCount} cached=${cachedCount} fail=${failCount}`,
            );
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
  console.log(`✓ Done. new=${okCount} already-cached=${cachedCount} failed=${failCount}`);
  console.log(`  Cache now has ${(await fs.readdir(CACHE_DIR)).filter((f) => f.endsWith('.jpg')).length} jpgs.`);
}

main().catch((err) => {
  console.error('✗ prefetch failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
