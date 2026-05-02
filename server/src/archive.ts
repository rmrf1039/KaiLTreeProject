import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { SpeciesConfig } from '../../shared/src/species/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.resolve(__dirname, '../../cache/archive');
const INDEX_PATH = path.resolve(ARCHIVE_DIR, 'index.json');

export const ARCHIVE_MAX_ENTRIES = 1000;
export const ARCHIVE_MAX_BYTES = 1 * 1024 * 1024;

export type ArchiveExt = 'webp' | 'jpg';

export type ArchiveEntry = {
  id: string;          // SHA256 of the image bytes — also the filename stem
  code: string;        // 4-digit tree code that produced the session
  addedAt: number;     // epoch ms
  ext?: ArchiveExt;    // file extension; absent on entries written before
                       // multi-format support — those are .webp on disk.
  // Snapshot of the user-tree shape at upload time. The meta-tree replays
  // these so the canopy filling with this user's photo matches the tree the
  // user just admired — same code, same species, same modifiers.
  seed?: number;
  speciesConfig?: SpeciesConfig;
};

let entries: ArchiveEntry[] = [];
let loaded = false;

export function loadArchiveIndex(): void {
  if (loaded) return;
  loaded = true;
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_PATH)) {
      entries = [];
      return;
    }
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ArchiveEntry[];
    entries = Array.isArray(parsed)
      ? parsed.filter(
          (e): e is ArchiveEntry =>
            !!e && typeof e.id === 'string' && /^[a-f0-9]{64}$/.test(e.id) && typeof e.code === 'string',
        )
      : [];
  } catch (err) {
    console.warn('[kai] archive index unreadable:', (err as Error).message);
    entries = [];
  }
}

function fsyncWriteJson(p: string, data: string): void {
  const tmp = `${p}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
}

export type AppendResult = { id: string; entry: ArchiveEntry; isNew: boolean };

function entryExt(e: ArchiveEntry): ArchiveExt {
  return e.ext ?? 'webp';
}

function entryFilePath(e: ArchiveEntry): string {
  return path.join(ARCHIVE_DIR, `${e.id}.${entryExt(e)}`);
}

/** Write a content-addressed image and append to the index. Idempotent on hash. */
export function appendArchive(
  buf: Buffer,
  code: string,
  ext: ArchiveExt = 'webp',
  treeShape?: { seed: number; speciesConfig: SpeciesConfig },
): AppendResult {
  loadArchiveIndex();
  const id = crypto.createHash('sha256').update(buf).digest('hex');
  const filePath = path.join(ARCHIVE_DIR, `${id}.${ext}`);

  const existing = entries.find((e) => e.id === id);
  if (existing && fs.existsSync(entryFilePath(existing))) {
    return { id, entry: existing, isNew: false };
  }

  // Write bytes durably (file may already exist — that's fine, overwrite is idempotent).
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);

  if (existing) return { id, entry: existing, isNew: false };

  const entry: ArchiveEntry = {
    id,
    code,
    addedAt: Date.now(),
    ext,
    ...(treeShape ? { seed: treeShape.seed, speciesConfig: treeShape.speciesConfig } : {}),
  };
  entries.push(entry);

  // FIFO trim. Drop oldest entries' files alongside their index rows so a
  // capped archive doesn't accumulate dead bytes on disk.
  if (entries.length > ARCHIVE_MAX_ENTRIES) {
    const drop = entries.length - ARCHIVE_MAX_ENTRIES;
    const dropped = entries.splice(0, drop);
    for (const d of dropped) {
      try {
        fs.unlinkSync(entryFilePath(d));
      } catch {
        /* file may already be gone */
      }
    }
  }

  fsyncWriteJson(INDEX_PATH, JSON.stringify(entries));
  return { id, entry, isNew: true };
}

export function listArchive(limit = 64): ArchiveEntry[] {
  loadArchiveIndex();
  if (limit <= 0) return [];
  // Most-recent-first.
  return entries.slice(-limit).reverse();
}

export function archiveCount(): number {
  loadArchiveIndex();
  return entries.length;
}

/**
 * Resolve an archive id to its on-disk path AND its content-type. Tries the
 * extension recorded in the index first, then both formats on disk so we
 * tolerate stale or missing index ext fields.
 */
export function archiveFile(id: string): { path: string; contentType: string } | null {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  loadArchiveIndex();
  const entry = entries.find((e) => e.id === id);
  const candidates: ArchiveExt[] = entry ? [entryExt(entry), entryExt(entry) === 'webp' ? 'jpg' : 'webp'] : ['webp', 'jpg'];
  for (const ext of candidates) {
    const fp = path.join(ARCHIVE_DIR, `${id}.${ext}`);
    if (fs.existsSync(fp)) {
      return { path: fp, contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg' };
    }
  }
  return null;
}

/** Legacy single-path lookup; defers to archiveFile(). */
export function archiveFilePath(id: string): string | null {
  return archiveFile(id)?.path ?? null;
}
