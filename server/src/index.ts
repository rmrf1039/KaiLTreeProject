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
import { getCurrentTree, loadSnapshot, saveSnapshotSync } from './state.js';
import { attachWebSocket, broadcast, countByRole } from './ws.js';

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
loadSnapshot();

let registryLoaded = false;
try {
  loadRegistry();
  registryLoaded = true;
  console.log(`[kai] Registry loaded: ${recordCount()} records`);
} catch (err) {
  console.warn(`[kai] Registry NOT loaded: ${(err as Error).message}`);
}

const app = express();
const httpServer = createServer(app);

app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    registryLoaded,
    records: recordCount(),
    currentTree: getCurrentTree()?.code ?? null,
    inputs: countByRole('input'),
    displays: countByRole('display'),
  });
});

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

  if (activeSearch) activeSearch.ctrl.abort();

  const searchId = crypto.randomUUID();
  const ctrl = new AbortController();
  activeSearch = { searchId, code, idempotencyKey, ctrl, startedAt: Date.now() };
  lastSubmitAt = Date.now();

  const response: SubmitResponse = { status: 'accepted', searchId };
  res.json(response);

  runSearch(searchId, code, ctrl);
});

async function runSearch(searchId: string, code: string, ctrl: AbortController): Promise<void> {
  broadcast({ type: 'search:started', searchId, code } satisfies WSMessage);

  try {
    const trees = await findTrees(code, ctrl.signal, (checked, found) => {
      if (activeSearch?.searchId !== searchId) return;
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
    };
    saveSnapshotSync(msg);
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
      };
      saveSnapshotSync(msg);
      broadcast(msg);
      activeSearch = null;
      return;
    }

    const reason = err instanceof LookupError ? err.reason : 'timeout';
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
