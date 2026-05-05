import { useCallback, useEffect, useRef, useState } from 'react';
import type { TreeReadyMessage, TreeRecord } from '../../../shared/src/types';
import type { SpeciesConfig } from '../../../shared/src/species/types';
import { generateFallbackLeaves } from '../lsystem/fallback';
import { Scene } from '../lsystem/scene';
import type { BuildMsg, BuildResult } from '../lsystem/worker';
import { useWebSocket } from '../ws';
import { useLifecycle } from '../lifecycle';
import { TreeInfoModal } from './TreeInfoModal';
import './DisplayPage.css';

const ATLAS_SIZE = 2048;
const VARIANTS_PER_SLOT = 12;
const NUM_SLOTS = 9;

type DisplayStatus = 'connecting' | 'idle' | 'loading' | 'building' | 'rendering' | 'meta' | 'empty' | 'error';

type MetaTreeManifest = {
  speciesConfig: SpeciesConfig;
  seed: number;
  leafImageUrls: string[];
  archiveCount: number;
};

export function DisplayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const fallbacksRef = useRef<ImageBitmap[] | null>(null);
  const currentRenderIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<DisplayStatus>('connecting');
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [currentTrees, setCurrentTrees] = useState<TreeRecord[]>([]);
  const [selectedTree, setSelectedTree] = useState<TreeRecord | null>(null);
  const { connState, subscribe, send } = useWebSocket('display');
  const { state: lc } = useLifecycle(subscribe, send);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio));
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const leaves = await generateFallbackLeaves(NUM_SLOTS, 256);
      if (mounted) fallbacksRef.current = leaves;
      else leaves.forEach((b) => b.close());
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        sceneRef.current?.dispose();
        sceneRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Fetch the given URLs as ImageBitmaps. Failures are silently dropped.
  // Returns an empty array if every URL fails (or none were given).
  const fetchBitmaps = useCallback(async (urls: string[]): Promise<ImageBitmap[]> => {
    const out: ImageBitmap[] = [];
    for (const url of urls) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        out.push(await createImageBitmap(blob));
      } catch {
        /* skip */
      }
    }
    return out;
  }, []);

  // Fill NUM_SLOTS by cycling the given source bitmaps. Caller guarantees
  // sources.length >= 1 — meta-tree mode bails out earlier when archive is empty.
  async function fillSlotsByCycling(sources: ImageBitmap[]): Promise<ImageBitmap[]> {
    const out: ImageBitmap[] = [];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const src = sources[i % sources.length]!;
      out.push(await cloneBitmap(src));
    }
    return out;
  }

  const renderTreeReady = useCallback(
    async (msg: TreeReadyMessage) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const renderId = `tree:${msg.searchId}`;
      currentRenderIdRef.current = renderId;
      setStatus('loading');
      setLastCode(msg.code);
      setErrMsg(null);
      setCurrentTrees(msg.trees);
      setSelectedTree(null);

      if (!fallbacksRef.current) {
        fallbacksRef.current = await generateFallbackLeaves(NUM_SLOTS, 256);
      }
      const fallbackSet = new Set(msg.fallbackSlots);
      const slotBitmaps: ImageBitmap[] = [];
      for (let i = 0; i < NUM_SLOTS; i++) {
        const useFallback = fallbackSet.has(i) || !msg.trees[i];
        if (useFallback) {
          const fb = fallbacksRef.current[i % fallbacksRef.current.length]!;
          slotBitmaps.push(await cloneBitmap(fb));
        } else {
          const tree = msg.trees[i]!;
          try {
            const resp = await fetch(tree.proxyUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            slotBitmaps.push(await createImageBitmap(blob));
          } catch {
            const fb = fallbacksRef.current[i % fallbacksRef.current.length]!;
            slotBitmaps.push(await cloneBitmap(fb));
          }
        }
      }

      if (currentRenderIdRef.current !== renderId) {
        slotBitmaps.forEach((b) => b.close());
        return;
      }

      await runBuild(renderId, msg.searchId, slotBitmaps, msg.seed, msg.speciesConfig, 'rendering');
    },
    [send],
  );

  // Wipe the canvas and stop any running scene — used when entering the empty
  // meta-tree state so the previous session's tree is cleared from screen.
  const clearCanvas = useCallback(() => {
    sceneRef.current?.dispose();
    sceneRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const renderMetaTree = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderId = `meta:${Date.now()}`;
    currentRenderIdRef.current = renderId;
    setStatus('loading');
    setLastCode(null);
    setErrMsg(null);
    setCurrentTrees([]);
    setSelectedTree(null);

    let manifest: MetaTreeManifest;
    try {
      const r = await fetch('/api/meta-tree');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      manifest = (await r.json()) as MetaTreeManifest;
    } catch (err) {
      setErrMsg(`meta-tree fetch: ${(err as Error).message}`);
      setStatus('error');
      return;
    }

    // Meta-tree is community-only: no fallback leaves. If the archive is
    // empty (or every leaf fetch failed), show the empty state — the tree
    // grows from the first captured photo onward.
    if (manifest.leafImageUrls.length === 0) {
      currentRenderIdRef.current = `meta:empty`;
      clearCanvas();
      setStatus('empty');
      return;
    }

    const sources = await fetchBitmaps(manifest.leafImageUrls);
    if (currentRenderIdRef.current !== renderId) {
      sources.forEach((b) => b.close());
      return;
    }
    if (sources.length === 0) {
      currentRenderIdRef.current = `meta:empty`;
      clearCanvas();
      setStatus('empty');
      return;
    }

    const slotBitmaps = await fillSlotsByCycling(sources);
    sources.forEach((b) => b.close());

    if (currentRenderIdRef.current !== renderId) {
      slotBitmaps.forEach((b) => b.close());
      return;
    }

    await runBuild(renderId, null, slotBitmaps, manifest.seed, manifest.speciesConfig, 'meta');
  }, [fetchBitmaps, clearCanvas]);

  // Hand off to the worker, swap the scene, and ack to the input view if this
  // was a user-tree render (searchId !== null). `maxHeightFraction` lets the
  // meta-tree fill more of the canvas than the user-tree, which keeps its
  // smaller leaf tiles legible.
  async function runBuild(
    renderId: string,
    searchId: string | null,
    bitmaps: ImageBitmap[],
    seed: number,
    speciesConfig: SpeciesConfig,
    finalStatus: DisplayStatus,
    maxHeightFraction?: number,
  ): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;

    sceneRef.current?.dispose();
    sceneRef.current = null;

    workerRef.current?.terminate();
    const worker = new Worker(new URL('../lsystem/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    setStatus('building');
    const buildMsg: BuildMsg = {
      type: 'build',
      seed,
      images: bitmaps,
      atlasSize: ATLAS_SIZE,
      variantsPerSlot: VARIANTS_PER_SLOT,
      speciesConfig,
    };

    const result = await new Promise<BuildResult | null>((resolve, reject) => {
      const handler = (ev: MessageEvent) => {
        const data = ev.data as { type?: string; message?: string };
        if (data?.type === 'build-result') {
          worker.removeEventListener('message', handler);
          resolve(ev.data as BuildResult);
        } else if (data?.type === 'build-error') {
          worker.removeEventListener('message', handler);
          reject(new Error(data.message ?? 'build failed'));
        }
      };
      worker.addEventListener('message', handler);
      worker.postMessage(buildMsg, bitmaps);
    }).catch((err) => {
      setErrMsg((err as Error).message);
      setStatus('error');
      return null;
    });

    if (!result) return;
    if (currentRenderIdRef.current !== renderId) {
      result.atlas.close();
      result.segAtlas.close();
      return;
    }

    if (searchId !== null) {
      send({ type: 'display:rendering', searchId });
    }
    canvas.classList.remove('fade-in');
    void canvas.offsetWidth;
    canvas.classList.add('fade-in');

    const scene = new Scene(canvas, result, { maxHeightFraction });
    sceneRef.current = scene;
    scene.start();
    setStatus(finalStatus);
  }

  // Subscribe to tree-ready (existing user-tree flow) + meta-tree:updated.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'snapshot') {
        if (msg.currentTree && `tree:${msg.currentTree.searchId}` !== currentRenderIdRef.current) {
          void renderTreeReady(msg.currentTree);
        }
      } else if (msg.type === 'tree-ready') {
        void renderTreeReady(msg);
      } else if (msg.type === 'search:failed') {
        if (currentRenderIdRef.current === null) {
          setErrMsg(msg.reason);
          setStatus('error');
        }
      } else if (msg.type === 'meta-tree:updated') {
        // Refresh only if we're currently *showing* the meta-tree — using a
        // ref (not lc.kind from closure) so we don't miss updates that arrive
        // in the same WS batch as a lifecycle transition.
        const cur = currentRenderIdRef.current ?? '';
        if (cur.startsWith('meta:')) void renderMetaTree();
      }
    });
  }, [subscribe, renderTreeReady, renderMetaTree]);

  // Switch back to the meta-tree as soon as the session ends. `resetting` is
  // the immediate post-session state (after consent-deny, timeout, or capture
  // upload), so reverting here drops the user-tree the moment the user skips
  // — the meta-tree appears in place of the lingering user-tree without
  // waiting the 1.5 s reset window. Idle still triggers on initial connect
  // (no tree showing yet); when entering idle from resetting it's a no-op
  // since meta is already up.
  useEffect(() => {
    const cur = currentRenderIdRef.current ?? '';
    if (lc.kind === 'resetting' && cur.startsWith('tree:')) {
      void renderMetaTree();
    } else if (lc.kind === 'idle' && !cur.startsWith('meta:')) {
      void renderMetaTree();
    }
  }, [lc.kind, renderMetaTree]);

  useEffect(() => {
    if (connState === 'open' && status === 'connecting') setStatus('idle');
    if (connState !== 'open') setStatus('connecting');
  }, [connState, status]);

  useEffect(
    () => () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    },
    [],
  );

  const firstTree = currentTrees[0] ?? null;
  const canOpenModal = status === 'rendering' && firstTree !== null;

  return (
    <div className="display">
      <canvas
        ref={canvasRef}
        className={`fade-in${canOpenModal ? ' clickable' : ''}`}
        onClick={() => {
          if (canOpenModal) setSelectedTree(firstTree);
        }}
      />
      <div className="display-overlay">
        <span className={`dot ${connState}`} />
        <span>{status}</span>
        {lastCode ? <span className="code">{lastCode}</span> : null}
        {errMsg ? <span className="err">· {errMsg}</span> : null}
      </div>
      {canOpenModal ? (
        <header className="display-header" aria-live="polite">
          <p className="display-header-line">
            <span className="display-header-label">IDentity of</span>
            <span className="display-header-id">#{firstTree.treeId}</span>
          </p>
        </header>
      ) : null}
      {status === 'empty' ? (
        <div className="display-empty">
          <p className="display-empty-title">等待第一張照片</p>
          <p className="display-empty-sub">輸入代碼，與您的樹合影，留下第一片葉子。</p>
        </div>
      ) : null}
      {selectedTree ? (
        <TreeInfoModal tree={selectedTree} onClose={() => setSelectedTree(null)} />
      ) : null}
    </div>
  );
}

async function cloneBitmap(bmp: ImageBitmap): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');
  ctx.drawImage(bmp, 0, 0);
  return c.transferToImageBitmap();
}
