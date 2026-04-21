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
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [state, setState] = useState<InputState>({ kind: 'idle' });
  const [presence, setPresence] = useState({ inputs: 0, displays: 0 });
  const { connState, subscribe } = useWebSocket('input');
  const doneTimerRef = useRef<number | undefined>(undefined);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([null, null, null, null]);

  const code = digits.join('');
  const isLocked = state.kind === 'submitting' || state.kind === 'searching';

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
        setDigits(['', '', '', '']);
        inputRefs.current[0]?.focus();
      }, 2500);
    }
    return () => {
      if (doneTimerRef.current !== undefined) clearTimeout(doneTimerRef.current);
    };
  }, [state.kind]);

  function canSubmitCode(c: string): boolean {
    return /^\d{4}$/.test(c) && (state.kind === 'idle' || state.kind === 'done' || state.kind === 'error');
  }

  async function submit(c: string): Promise<void> {
    if (!canSubmitCode(c)) return;
    setState({ kind: 'submitting', code: c });
    const idempotencyKey = crypto.randomUUID();
    try {
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c, idempotencyKey }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({ error: 'submit-failed' }))) as { error?: string };
        setState({ kind: 'error', message: err.error ?? `HTTP ${r.status}` });
      }
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  }

  function updateDigit(index: number, value: string): void {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length > 1) {
      // Paste: spread across boxes starting at index
      const next = [...digits];
      for (let i = 0; i < cleaned.length && index + i < 4; i++) {
        next[index + i] = cleaned[i]!;
      }
      setDigits(next);
      const focusIdx = Math.min(index + cleaned.length, 3);
      inputRefs.current[focusIdx]?.focus();
      if (next.every((d) => d !== '')) void submit(next.join(''));
      return;
    }
    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    if (cleaned && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
    if (next.every((d) => d !== '')) void submit(next.join(''));
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Backspace') {
      if (digits[index] === '' && index > 0) {
        e.preventDefault();
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 3) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canSubmitCode(code)) void submit(code);
    }
  }

  return (
    <main className="input">
      <div className="input-topbar">
        <span className={`dot ${connState}`} />
        <span>server {connState}</span>
        <span className="sep">·</span>
        <span>
          {presence.displays} display{presence.displays === 1 ? '' : 's'}
        </span>
      </div>

      <div className="input-center">
        <h1 className="input-title">找到你的數位樹</h1>

        <div className="otp" role="group" aria-label="4-digit code">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              className="otp-box"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              value={d}
              autoFocus={i === 0}
              disabled={isLocked}
              onChange={(e) => updateDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={`Digit ${i + 1}`}
            />
          ))}
        </div>

        <div className="input-status">
          <StatusView state={state} />
        </div>
      </div>
    </main>
  );
}

function StatusView({ state }: { state: InputState }) {
  switch (state.kind) {
    case 'idle':
      return <p className="muted">&nbsp;</p>;
    case 'submitting':
      return <p>Submitting {state.code}…</p>;
    case 'searching': {
      const pct = Math.round((state.checked / SEARCH_CANDIDATES) * 100);
      return (
        <div>
          <p>
            Searching · {state.checked}/{SEARCH_CANDIDATES} · found {state.found}/9
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
        <p>
          {state.kind === 'rendering' ? 'Rendering on display — ' : 'Display ready — '}
          {state.trees.length} real / {state.fallbackSlots.length} fallback
        </p>
      );
    case 'done':
      return <p className="muted">完成。請輸入下一組代碼。</p>;
    case 'error':
      return <p className="error">Error: {state.message}</p>;
  }
}
