import { useCallback, useEffect, useRef, useState } from 'react';
import type { TreeReadyMessage, TreeRecord } from '../../../shared/src/types';
import { generateFallbackLeaves } from '../lsystem/fallback';
import { Scene } from '../lsystem/scene';
import type { BuildMsg, BuildResult } from '../lsystem/worker';
import { useWebSocket } from '../ws';
import { TreeInfoModal } from './TreeInfoModal';
import './DisplayPage.css';

const ATLAS_SIZE = 2048;
const VARIANTS_PER_SLOT = 12;
const NUM_SLOTS = 9;

type DisplayStatus = 'connecting' | 'idle' | 'loading' | 'building' | 'rendering' | 'error';

export function DisplayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const fallbacksRef = useRef<ImageBitmap[] | null>(null);
  const currentSearchIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<DisplayStatus>('connecting');
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [currentTrees, setCurrentTrees] = useState<TreeRecord[]>([]);
  const [selectedTree, setSelectedTree] = useState<TreeRecord | null>(null);
  const { connState, subscribe, send } = useWebSocket('display');

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

  const renderTreeReady = useCallback(
    async (msg: TreeReadyMessage) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      currentSearchIdRef.current = msg.searchId;
      setStatus('loading');
      setLastCode(msg.code);
      setErrMsg(null);
      setCurrentTrees(msg.trees);
      setSelectedTree(null);

      if (!fallbacksRef.current) {
        fallbacksRef.current = await generateFallbackLeaves(NUM_SLOTS, 256);
      }

      const fallbackSet = new Set(msg.fallbackSlots);
      const bitmaps: ImageBitmap[] = [];

      for (let i = 0; i < NUM_SLOTS; i++) {
        const useFallback = fallbackSet.has(i) || !msg.trees[i];
        if (useFallback) {
          const fb = fallbacksRef.current[i % fallbacksRef.current.length]!;
          bitmaps.push(await cloneBitmap(fb));
        } else {
          const tree = msg.trees[i]!;
          try {
            const resp = await fetch(tree.proxyUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            bitmaps.push(await createImageBitmap(blob));
          } catch {
            const fb = fallbacksRef.current[i % fallbacksRef.current.length]!;
            bitmaps.push(await cloneBitmap(fb));
          }
        }
      }

      if (currentSearchIdRef.current !== msg.searchId) {
        bitmaps.forEach((b) => b.close());
        return;
      }

      sceneRef.current?.dispose();
      sceneRef.current = null;

      workerRef.current?.terminate();
      const worker = new Worker(new URL('../lsystem/worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;

      setStatus('building');
      const buildMsg: BuildMsg = {
        type: 'build',
        seed: msg.seed,
        images: bitmaps,
        atlasSize: ATLAS_SIZE,
        variantsPerSlot: VARIANTS_PER_SLOT,
        speciesConfig: msg.speciesConfig,
      };

      const result = await new Promise<BuildResult>((resolve, reject) => {
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
      if (currentSearchIdRef.current !== msg.searchId) {
        result.atlas.close();
        result.segAtlas.close();
        return;
      }

      send({ type: 'display:rendering', searchId: msg.searchId });
      canvas.classList.remove('fade-in');
      void canvas.offsetWidth; // reflow so the transition restarts
      canvas.classList.add('fade-in');

      const scene = new Scene(canvas, result);
      sceneRef.current = scene;
      scene.start();
      setStatus('rendering');
    },
    [send],
  );

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'snapshot') {
        if (msg.currentTree && msg.currentTree.searchId !== currentSearchIdRef.current) {
          void renderTreeReady(msg.currentTree);
        }
      } else if (msg.type === 'tree-ready') {
        void renderTreeReady(msg);
      } else if (msg.type === 'search:failed') {
        if (currentSearchIdRef.current === null) {
          setErrMsg(msg.reason);
          setStatus('error');
        }
      }
    });
  }, [subscribe, renderTreeReady]);

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
