import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../cache/images');
const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

export async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

const HASH_RE = /^[a-f0-9]{64}$/;

export async function listCachedImages(): Promise<string[]> {
  try {
    const entries = await fs.readdir(CACHE_DIR);
    return entries
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => f.slice(0, -4))
      .filter((h) => HASH_RE.test(h));
  } catch {
    return [];
  }
}

export async function handleCachedImage(req: Request, res: Response): Promise<void> {
  const raw = String(req.params.hash ?? '');
  const hash = raw.endsWith('.jpg') ? raw.slice(0, -4) : raw;
  if (!HASH_RE.test(hash)) {
    res.status(400).send('bad hash');
    return;
  }
  const cpath = path.join(CACHE_DIR, `${hash}.jpg`);
  if (!fssync.existsSync(cpath)) {
    res.status(404).send('not found');
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Access-Control-Allow-Origin', '*');
  fssync.createReadStream(cpath).pipe(res);
}

function cacheKey(dist: string, treeId: string): string {
  return crypto.createHash('sha256').update(`${dist}/${treeId}`).digest('hex');
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.jpg`);
}

function upstreamUrl(dist: string, treeId: string): string {
  return `https://geopkl.gov.taipei/images/commonTree/${encodeURIComponent(dist)}/${encodeURIComponent(treeId)}.jpg`;
}

function setImageHeaders(res: Response, cacheState: 'hit' | 'miss'): void {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Tree-Cache', cacheState);
}

export async function handleTreeImage(req: Request, res: Response): Promise<void> {
  const dist = decodeURIComponent(String(req.params.dist ?? ''));
  const file = String(req.params.file ?? '');
  if (!file.toLowerCase().endsWith('.jpg')) {
    res.status(400).send('path must end with .jpg');
    return;
  }
  const treeId = decodeURIComponent(file.slice(0, -4));

  if (!dist || !treeId || dist.includes('/') || treeId.includes('/')) {
    res.status(400).send('bad request');
    return;
  }

  const key = cacheKey(dist, treeId);
  const cpath = cachePath(key);

  if (fssync.existsSync(cpath)) {
    setImageHeaders(res, 'hit');
    fssync.createReadStream(cpath).pipe(res);
    return;
  }

  const ctrl = new AbortController();
  const onClose = () => ctrl.abort();
  req.on('close', onClose);
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl(dist, treeId), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) KaiProject/1.0',
        Referer: 'https://geopkl.gov.taipei/',
        Accept: 'image/*',
      },
    });

    if (!upstream.ok) {
      res.status(502).json({ error: 'upstream-not-ok', status: upstream.status });
      return;
    }
    const ct = (upstream.headers.get('content-type') ?? '').toLowerCase();
    if (!ct.startsWith('image/jpeg')) {
      res.status(415).json({ error: 'wrong-content-type', ct });
      return;
    }
    const declared = Number(upstream.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) {
      res.status(413).json({ error: 'too-large-declared', size: declared });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      res.status(413).json({ error: 'too-large-actual', size: buf.length });
      return;
    }
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      res.status(415).json({ error: 'bad-magic-bytes' });
      return;
    }

    const tmp = `${cpath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, cpath);

    setImageHeaders(res, 'miss');
    res.end(buf);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'upstream-failed', message: (err as Error).message });
    }
  } finally {
    clearTimeout(timer);
    req.off('close', onClose);
  }
}
