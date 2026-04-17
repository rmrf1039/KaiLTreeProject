import { useEffect, useRef, useState } from 'react';
import type { TreeRecord, WSMessage } from '../../../shared/src/types';
import { useWebSocket } from '../ws';
import './InputPage.css';

type InputState =
  | { kind: 'idle' }
  | { kind: 'submitting'; code: string }
  | { kind: 'searching'; code: string; searchId: string; checked: number; found: number }
  | { kind: 'ready'; code: string; trees: TreeRecord[]; fallbackSlots: number[] }
  | { kind: 'rendering'; code: string; trees: TreeRecord[]; fallbackSlots: number[] }
  | { kind: 'done'; code: string }
  | { kind: 'error'; message: string };

const SEARCH_CANDIDATES = 161;

export function InputPage() {
  const [code, setCode] = useState('');
  const [state, setState] = useState<InputState>({ kind: 'idle' });
  const [presence, setPresence] = useState({ inputs: 0, displays: 0 });
  const { connState, subscribe } = useWebSocket('input');
  const doneTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return subscribe((msg: WSMessage) => {
      switch (msg.type) {
        case 'snapshot':
          setPresence({ inputs: msg.inputs, displays: msg.displays });
          break;
        case 'search:started':
          setState((s) =>
            s.kind === 'submitting' && s.code === msg.code
              ? { kind: 'searching', code: msg.code, searchId: msg.searchId, checked: 0, found: 0 }
              : s,
          );
          break;
        case 'search:progress':
          setState((s) =>
            s.kind === 'searching' && s.searchId === msg.searchId
              ? { ...s, checked: msg.checked, found: msg.found }
              : s,
          );
          break;
        case 'tree-ready':
          setState({
            kind: 'ready',
            code: msg.code,
            trees: msg.trees,
            fallbackSlots: msg.fallbackSlots,
          });
          break;
        case 'display:rendering':
          setState((s) =>
            s.kind === 'ready' ? { kind: 'rendering', code: s.code, trees: s.trees, fallbackSlots: s.fallbackSlots } : s,
          );
          break;
        case 'search:failed':
          setState({ kind: 'error', message: msg.reason });
          break;
        default:
          break;
      }
    });
  }, [subscribe]);

  useEffect(() => {
    if (state.kind === 'rendering' || state.kind === 'ready') {
      if (doneTimerRef.current !== undefined) clearTimeout(doneTimerRef.current);
      doneTimerRef.current = window.setTimeout(() => {
        setState((s) => (s.kind === 'rendering' || s.kind === 'ready' ? { kind: 'done', code: s.code } : s));
      }, 8000);
    }
    if (state.kind === 'done') {
      if (doneTimerRef.current !== undefined) clearTimeout(doneTimerRef.current);
      doneTimerRef.current = window.setTimeout(() => {
        setState({ kind: 'idle' });
      }, 2500);
    }
    return () => {
      if (doneTimerRef.current !== undefined) clearTimeout(doneTimerRef.current);
    };
  }, [state.kind]);

  const canSubmit =
    /^\d{4}$/.test(code) &&
    (state.kind === 'idle' || state.kind === 'done' || state.kind === 'error');

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setState({ kind: 'submitting', code });
    const idempotencyKey = crypto.randomUUID();
    try {
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, idempotencyKey }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({ error: 'submit-failed' }))) as { error?: string };
        setState({ kind: 'error', message: err.error ?? `HTTP ${r.status}` });
      }
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }

  return (
    <main className="input">
      <header className="input-header">
        <h1>Taipei Street-Tree L-System</h1>
        <div className="presence">
          <span className={`dot ${connState}`} />
          <span>server {connState}</span>
          <span className="sep">·</span>
          <span>{presence.displays} display{presence.displays === 1 ? '' : 's'} connected</span>
        </div>
      </header>

      <form className="entry" onSubmit={handleSubmit}>
        <label htmlFor="code">Enter a 4-digit code (MMDD)</label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          maxLength={4}
          pattern="\d{4}"
          autoFocus
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          disabled={state.kind === 'submitting' || state.kind === 'searching'}
        />
        <button type="submit" disabled={!canSubmit}>
          {state.kind === 'submitting' || state.kind === 'searching' ? 'Searching…' : 'Grow tree'}
        </button>
      </form>

      <section className="status">
        <StatusView state={state} />
      </section>
    </main>
  );
}

function StatusView({ state }: { state: InputState }) {
  switch (state.kind) {
    case 'idle':
      return <p className="muted">Waiting for input.</p>;
    case 'submitting':
      return <p>Submitting {state.code}…</p>;
    case 'searching': {
      const pct = Math.round((state.checked / SEARCH_CANDIDATES) * 100);
      return (
        <div>
          <p>
            Searching for photos · checked {state.checked}/{SEARCH_CANDIDATES} · found {state.found}/9
          </p>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    case 'ready':
    case 'rendering':
      return (
        <div>
          <p>
            {state.kind === 'rendering' ? 'Rendering on display — ' : 'Display ready — '}
            {state.trees.length} real / {state.fallbackSlots.length} fallback
          </p>
          <div className="grid">
            {Array.from({ length: 9 }, (_, i) => {
              const tree = state.trees[i];
              const isFallback = state.fallbackSlots.includes(i);
              return (
                <div key={i} className={`tile ${isFallback ? 'tile-fallback' : ''}`}>
                  {tree ? (
                    <img src={tree.proxyUrl} alt={`${tree.dist} / ${tree.treeId}`} loading="lazy" />
                  ) : (
                    <span>fallback</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    case 'done':
      return <p className="muted">Done. Enter another code.</p>;
    case 'error':
      return <p className="error">Error: {state.message}</p>;
  }
}
