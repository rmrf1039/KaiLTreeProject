import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import type {
  SubmitRequest,
  SubmitResponse,
  TreeReadyMessage,
  WSMessage,
} from '../../shared/src/types.js';
import { loadRegistry, recordCount } from './registry.js';
import { LookupError, findTrees } from './findTrees.js';
import { ensureCacheDir, handleCachedImage, handleTreeImage, listCachedImages } from './imageProxy.js';
import { clearSnapshot, getCurrentTree, loadSnapshot, saveSnapshotSync } from './state.js';
import { applyModifiers } from '../../shared/src/species/modifiers.js';
import { resolveSpecies } from './species/resolver.js';
import { computeModifiers } from './species/stress.js';
import { attachWebSocket, broadcast, countByRole } from './ws.js';
import { lifecycle } from './lifecycle.js';
import { appendArchive, archiveCount, archiveFile, loadArchiveIndex, listArchive } from './archive.js';
import { buildMetaTreeManifest } from './metaTree.js';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '../../client');
const clientDist = path.resolve(clientRoot, 'dist');
const isProd = process.env.NODE_ENV === 'production';

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

await ensureCacheDir();

// Registry must load before snapshot so snapshot rehydration sees the species
// stats it needs to compute modifiers. computeModifiers is registry-tolerant
// so the order isn't strictly required, but loading registry first means a
// rehydrated snapshot reflects the latest stress signal from the moment it
// arrives — no second pass needed.
let registryLoaded = false;
try {
  loadRegistry();
  registryLoaded = true;
  console.log(`[kai] Registry loaded: ${recordCount()} records`);
} catch (err) {
  console.warn(`[kai] Registry NOT loaded: ${(err as Error).message}`);
}

loadSnapshot();
loadArchiveIndex();

// When the session returns to idle, expunge the in-memory + on-disk tree.
// Privacy: a non-consented (or any past) user's geometry must not survive past
// the session boundary.
lifecycle.subscribe((state) => {
  if (state.kind === 'idle') clearSnapshot();
});

const app = express();
const httpServer = createServer(app);

app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    registryLoaded,
    records: recordCount(),
    currentTree: getCurrentTree()?.code ?? null,
    lifecycle: lifecycle.getState().kind,
    archived: archiveCount(),
    inputs: countByRole('input'),
    displays: countByRole('display'),
  });
});

app.get('/api/meta-tree', (_req, res) => {
  res.json(buildMetaTreeManifest());
});

app.get('/api/archive/leaves', (req, res) => {
  const limit = Math.max(1, Math.min(256, Number(req.query.limit) || 64));
  const recent = listArchive(limit);
  res.json({
    entries: recent.map((e) => ({
      id: e.id,
      code: e.code,
      addedAt: e.addedAt,
      thumbnailUrl: `/proxy/archive-image/${e.id}`,
    })),
  });
});

app.get('/proxy/archive-image/:id', (req, res) => {
  const id = String(req.params.id ?? '').replace(/\.(webp|jpg|jpeg)$/, '');
  const f = archiveFile(id);
  if (!f) {
    res.status(404).send('not found');
    return;
  }
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Access-Control-Allow-Origin', '*');
  fs.createReadStream(f.path).pipe(res);
});

// Raw image upload — restricted to image/webp + image/jpeg via the express.raw
// type filter. Both formats are produced from a fresh canvas re-encode on the
// client, so neither can carry source EXIF; defense in depth is the magic-byte
// check below + the strict content-type allow-list.
app.post(
  '/api/archive',
  express.raw({ type: ['image/webp', 'image/jpeg'], limit: '1mb' }),
  (req, res) => {
    const sessionId = String(req.query.sessionId ?? '');
    const code = String(req.query.code ?? '');
    if (!sessionId || !code) {
      res.status(400).json({ error: 'missing-params' });
      return;
    }

    const lc = lifecycle.getState();
    if (lc.kind !== 'archiving' || lc.sessionId !== sessionId || lc.code !== code) {
      res.status(409).json({ error: 'not-in-archiving', state: lc.kind });
      return;
    }

    const buf = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: 'empty-body' });
      return;
    }
    // WebP magic: "RIFF" .... "WEBP"
    const isWebp =
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50;
    // JPEG magic: 0xff 0xd8 0xff (SOI + first segment marker prefix)
    const isJpeg =
      buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!isWebp && !isJpeg) {
      res.status(415).json({ error: 'not-image' });
      return;
    }

    // Snapshot the user-tree shape from the active session so the meta-tree
    // can replay it: same code → same species → same seed. The current tree
    // exists here because we're in the `archiving` lifecycle state, which
    // only follows a successful tree-resolve.
    const cur = getCurrentTree();
    const treeShape = cur && cur.code === code
      ? { seed: cur.seed, speciesConfig: cur.speciesConfig }
      : undefined;

    const result = appendArchive(buf, code, isWebp ? 'webp' : 'jpg', treeShape);
    lifecycle.transition({ kind: 'capture-uploaded', sessionId });
    if (result.isNew) broadcast({ type: 'meta-tree:updated' });
    res.json({ id: result.id, isNew: result.isNew });
  },
);

app.get('/proxy/tree-image/:dist/:file', handleTreeImage);

app.get('/api/bg-images', async (_req, res) => {
  const hashes = await listCachedImages();
  const urls = hashes.map((h) => `/proxy/cached-image/${h}`);
  res.json({ images: urls });
});

app.get('/proxy/cached-image/:hash', handleCachedImage);

type ActiveSearch = {
  searchId: string;
  code: string;
  idempotencyKey: string;
  ctrl: AbortController;
  startedAt: number;
};

let activeSearch: ActiveSearch | null = null;
let lastSubmitAt = 0;
const SUBMIT_DEBOUNCE_MS = 2_000;

app.post('/api/submit', (req, res) => {
  const body = req.body as Partial<SubmitRequest>;
  const code = String(body.code ?? '').trim();
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();

  if (!/^\d{4}$/.test(code)) {
    res.status(400).json({ error: 'invalid-code' });
    return;
  }
  if (!idempotencyKey) {
    res.status(400).json({ error: 'missing-idempotency-key' });
    return;
  }
  if (activeSearch?.idempotencyKey === idempotencyKey) {
    res.status(409).json({ error: 'duplicate-submit' });
    return;
  }
  const since = Date.now() - lastSubmitAt;
  if (since < SUBMIT_DEBOUNCE_MS) {
    res.status(429).json({ error: 'debounced', retryAfterMs: SUBMIT_DEBOUNCE_MS - since });
    return;
  }

  // FSM is the gatekeeper for "can a new session start now?". A submit is only
  // legal from idle/resetting; if the previous session is still mid-prompt or
  // mid-archive, refuse rather than racing.
  const result = lifecycle.transition({ kind: 'submit', code });
  if (!result.ok) {
    res.status(409).json({ error: 'busy' });
    return;
  }
  const sessionId = (result.state as { sessionId: string }).sessionId;

  if (activeSearch) activeSearch.ctrl.abort();

  const ctrl = new AbortController();
  activeSearch = { searchId: sessionId, code, idempotencyKey, ctrl, startedAt: Date.now() };
  lastSubmitAt = Date.now();

  const response: SubmitResponse = { status: 'accepted', searchId: sessionId };
  res.json(response);

  runSearch(sessionId, code, ctrl);
});

async function runSearch(searchId: string, code: string, ctrl: AbortController): Promise<void> {
  broadcast({ type: 'search:started', searchId, code } satisfies WSMessage);

  try {
    const trees = await findTrees(code, ctrl.signal, (checked, found) => {
      if (activeSearch?.searchId !== searchId) return;
      lifecycle.transition({ kind: 'query-progress', sessionId: searchId, checked, found });
      broadcast({ type: 'search:progress', searchId, checked, found } satisfies WSMessage);
    });

    if (activeSearch?.searchId !== searchId) return;

    const seed = hash32(code);
    const fallbackSlots: number[] = [];
    for (let i = trees.length; i < 9; i++) fallbackSlots.push(i);

    const msg: TreeReadyMessage = {
      type: 'tree-ready',
      searchId,
      code,
      seed,
      trees,
      fallbackSlots,
      speciesConfig: applyModifiers(
        resolveSpecies(trees[0]?.treeType ?? ''),
        computeModifiers(trees[0]),
      ),
    };
    saveSnapshotSync(msg);
    lifecycle.transition({ kind: 'tree-resolved', sessionId: searchId });
    broadcast(msg);
    if (activeSearch?.searchId === searchId) activeSearch = null;
  } catch (err) {
    if (activeSearch?.searchId !== searchId) return;

    if (err instanceof LookupError && err.reason === 'insufficient-photos') {
      const seed = hash32(code);
      const msg: TreeReadyMessage = {
        type: 'tree-ready',
        searchId,
        code,
        seed,
        trees: [],
        fallbackSlots: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        speciesConfig: applyModifiers(resolveSpecies(''), computeModifiers(undefined)),
      };
      saveSnapshotSync(msg);
      lifecycle.transition({ kind: 'tree-resolved', sessionId: searchId });
      broadcast(msg);
      activeSearch = null;
      return;
    }

    const reason = err instanceof LookupError ? err.reason : 'timeout';
    lifecycle.transition({ kind: 'search-failed', sessionId: searchId });
    broadcast({ type: 'search:failed', searchId, reason } satisfies WSMessage);
    activeSearch = null;
  }
}

if (isProd) {
  app.use(express.static(clientDist, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: clientRoot,
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const wss = new WebSocketServer({ noServer: true });
attachWebSocket(wss);

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
  // Any other upgrade path (Vite HMR) is left for other upgrade listeners.
});

const PORT = Number(process.env.PORT) || 4848;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n[kai] Server ready (${isProd ? 'production' : 'dev'})`);
  console.log(`      Input   → http://localhost:${PORT}/input`);
  const addrs = lanAddresses();
  if (addrs.length === 0) {
    console.log(`      Display → http://localhost:${PORT}/display`);
  } else {
    for (const addr of addrs) {
      console.log(`      Display → http://${addr}:${PORT}/display`);
    }
  }
  console.log('');
});
