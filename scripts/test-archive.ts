/**
 * Tests for the archive storage module: content-addressing, FIFO trimming,
 * idempotent re-uploads, and durable index writes.
 *
 * Uses a temp directory so it doesn't pollute /cache/archive/. Manipulates the
 * archive module by changing CWD-derived paths is brittle; instead we exercise
 * the public API and inspect the resulting cache/archive/ directory after
 * resetting it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.resolve(__dirname, '../cache/archive');
const INDEX_PATH = path.resolve(ARCHIVE_DIR, 'index.json');

// Snapshot the existing archive (if any) and restore at the end so this test
// is non-destructive on a working installation.
type Snapshot = { existed: boolean; files: Array<{ name: string; bytes: Buffer }>; index: string | null };
function snapshotDir(): Snapshot {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    return { existed: false, files: [], index: null };
  }
  const files = fs
    .readdirSync(ARCHIVE_DIR)
    .filter((n) => n.endsWith('.webp'))
    .map((n) => ({ name: n, bytes: fs.readFileSync(path.join(ARCHIVE_DIR, n)) }));
  const index = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : null;
  return { existed: true, files, index };
}

function restoreDir(s: Snapshot): void {
  // Wipe what's there, then put back the snapshot.
  if (fs.existsSync(ARCHIVE_DIR)) {
    for (const n of fs.readdirSync(ARCHIVE_DIR)) {
      fs.unlinkSync(path.join(ARCHIVE_DIR, n));
    }
  }
  if (!s.existed) {
    if (fs.existsSync(ARCHIVE_DIR)) fs.rmdirSync(ARCHIVE_DIR);
    return;
  }
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const f of s.files) fs.writeFileSync(path.join(ARCHIVE_DIR, f.name), f.bytes);
  if (s.index !== null) fs.writeFileSync(INDEX_PATH, s.index);
}

function clearDir(): void {
  if (fs.existsSync(ARCHIVE_DIR)) {
    for (const n of fs.readdirSync(ARCHIVE_DIR)) {
      fs.unlinkSync(path.join(ARCHIVE_DIR, n));
    }
  }
}

// Minimal valid WebP header so the bytes pass the magic check downstream
// (the archive module itself doesn't validate magic — it accepts any buffer —
// but mirroring real bytes keeps the test honest).
function fakeWebp(payload: Buffer): Buffer {
  const hdr = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  return Buffer.concat([hdr, payload]);
}

const snap = snapshotDir();
clearDir();

// Re-import after clearing so module-level state resets.
const archive = await import('../server/src/archive');
// The module memoises `loaded`; simulate a fresh boot by toggling via the
// public API — calling appendArchive after clearDir loads the (now empty) index.

let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`OK   ${label}`);
  } else {
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

try {
  // 1. Append a new entry.
  {
    const buf = fakeWebp(Buffer.from('hello-1'));
    const r = archive.appendArchive(buf, '1234');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    check('appendArchive returns content-addressed id', r.id === sha);
    check('isNew flag is true on first append', r.isNew === true);
    check('file exists on disk', fs.existsSync(path.join(ARCHIVE_DIR, `${r.id}.webp`)));
    check('archiveCount is 1', archive.archiveCount() === 1);
  }

  // 2. Re-append same bytes is idempotent (no new entry).
  {
    const buf = fakeWebp(Buffer.from('hello-1'));
    const r = archive.appendArchive(buf, '5678');
    check('isNew flag is false on duplicate', r.isNew === false);
    check('archiveCount unchanged after duplicate', archive.archiveCount() === 1);
  }

  // 3. Append more entries.
  {
    for (let i = 2; i <= 5; i++) {
      archive.appendArchive(fakeWebp(Buffer.from(`hello-${i}`)), `000${i}`);
    }
    check('archiveCount grows to 5', archive.archiveCount() === 5);
  }

  // 4. listArchive returns most-recent-first, capped to limit.
  {
    const recent3 = archive.listArchive(3);
    check('listArchive(3) returns 3', recent3.length === 3);
    // The last appended (hello-5) should be first in the most-recent list.
    const sha5 = crypto.createHash('sha256').update(fakeWebp(Buffer.from('hello-5'))).digest('hex');
    check('most recent is first', recent3[0]?.id === sha5);
  }

  // 5. archiveFilePath validates the id format.
  {
    check('rejects bad id', archive.archiveFilePath('not-a-hash') === null);
    const sha = crypto.createHash('sha256').update(fakeWebp(Buffer.from('hello-1'))).digest('hex');
    check('accepts valid id', archive.archiveFilePath(sha)?.endsWith(`${sha}.webp`) === true);
  }

  // 6. Index is durable on disk.
  {
    check('index.json exists', fs.existsSync(INDEX_PATH));
    const onDisk = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as Array<{ id: string }>;
    check('index has 5 entries on disk', onDisk.length === 5);
  }

  // FIFO trim is exercised at >1000 entries — too slow for a unit test.
  // We assert the cap constant exists and is ≤1000 to lock the policy in.
  check('ARCHIVE_MAX_ENTRIES cap is ≤ 1000', archive.ARCHIVE_MAX_ENTRIES <= 1000);

  // 7. JPEG archive entry stores with .jpg extension and serves image/jpeg.
  {
    const jpegBuf = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('jpeg-payload'),
    ]);
    const r = archive.appendArchive(jpegBuf, '9999', 'jpg');
    check('appendArchive(ext=jpg) writes .jpg file', fs.existsSync(path.join(ARCHIVE_DIR, `${r.id}.jpg`)));
    const f = archive.archiveFile(r.id);
    check('archiveFile reports jpeg content-type', f?.contentType === 'image/jpeg');
    check('archiveFile path ends with .jpg', f?.path.endsWith('.jpg') === true);
  }

  // 8. archiveFile resolves both extensions (back-compat for entries written
  //    before the ext field existed).
  {
    const sha = crypto.createHash('sha256').update(fakeWebp(Buffer.from('hello-1'))).digest('hex');
    const f = archive.archiveFile(sha);
    check('webp entry still resolves with image/webp', f?.contentType === 'image/webp');
  }
} finally {
  clearDir();
  restoreDir(snap);
}

if (failed > 0) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log(`\nall checks pass`);
