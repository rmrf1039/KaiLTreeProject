import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TreeReadyMessage } from '../../shared/src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../cache');
const SNAPSHOT_PATH = path.resolve(CACHE_DIR, 'last.json');

let currentTree: TreeReadyMessage | null = null;

export function loadSnapshot(): void {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return;
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as TreeReadyMessage;
    if (parsed?.type === 'tree-ready' && Array.isArray(parsed.trees)) {
      currentTree = parsed;
    }
  } catch (err) {
    console.warn('[kai] last.json unreadable:', (err as Error).message);
  }
}

/** fsync-durable write so a hard kill between `tree-ready` and broadcast still replays. */
export function saveSnapshotSync(t: TreeReadyMessage): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${SNAPSHOT_PATH}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(t));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, SNAPSHOT_PATH);
  currentTree = t;
}

export function getCurrentTree(): TreeReadyMessage | null {
  return currentTree;
}
