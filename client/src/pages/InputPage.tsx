import { useEffect, useRef, useState } from 'react';
import type { LifecycleState, TreeRecord, WSMessage } from '../../../shared/src/types';
import { useWebSocket } from '../ws';
import { useLifecycle } from '../lifecycle';
import { BackgroundField } from './BackgroundField';
import { ConsentModal } from './ConsentModal';
import { CaptureFlow } from '../camera/CaptureFlow';
import './InputPage.css';

const SEARCH_CANDIDATES = 161;

type TreeDetails = { trees: TreeRecord[]; fallbackSlots: number[] } | null;

export function InputPage() {
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [presence, setPresence] = useState({ inputs: 0, displays: 0 });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [treeDetails, setTreeDetails] = useState<TreeDetails>(null);
  const { connState, subscribe, send } = useWebSocket('input');
  const { state: lc, dispatch } = useLifecycle(subscribe, send);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([null, null, null, null]);

  const code = digits.join('');
  const isLocked = lc.kind !== 'idle';

  // Listen for presence + tree-ready details (the lifecycle state is FSM stage;
  // the tree-ready event carries N-real / M-fallback counts the operator sees).
  useEffect(() => {
    return subscribe((msg: WSMessage) => {
      if (msg.type === 'snapshot') {
        setPresence({ inputs: msg.inputs, displays: msg.displays });
        if (msg.currentTree) {
          setTreeDetails({ trees: msg.currentTree.trees, fallbackSlots: msg.currentTree.fallbackSlots });
        }
      } else if (msg.type === 'tree-ready') {
        setTreeDetails({ trees: msg.trees, fallbackSlots: msg.fallbackSlots });
      }
    });
  }, [subscribe]);

  // When the FSM returns to idle, reset the keypad and focus.
  useEffect(() => {
    if (lc.kind === 'idle') {
      setDigits(['', '', '', '']);
      setSubmitError(null);
      setTreeDetails(null);
      inputRefs.current[0]?.focus();
    }
  }, [lc.kind]);

  function canSubmitCode(c: string): boolean {
    return /^\d{4}$/.test(c) && lc.kind === 'idle';
  }

  async function submit(c: string): Promise<void> {
    if (!canSubmitCode(c)) return;
    setSubmitError(null);
    const idempotencyKey = crypto.randomUUID();
    try {
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: c, idempotencyKey }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({ error: 'submit-failed' }))) as { error?: string };
        setSubmitError(err.error ?? `HTTP ${r.status}`);
      }
    } catch (err) {
      setSubmitError((err as Error).message);
    }
  }

  function updateDigit(index: number, value: string): void {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length > 1) {
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
      <BackgroundField />
      <div className="input-topbar">
        <span className={`dot ${connState}`} />
        <span>server {connState}</span>
        <span className="sep">·</span>
        <span>
          {presence.displays} display{presence.displays === 1 ? '' : 's'}
        </span>
      </div>

      <div className="input-center">
        <div className={`input-card ${lc.kind === 'prompting' || lc.kind === 'archiving' ? 'dimmed' : ''}`}>
          <h1 className="input-title">IDentity</h1>

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
            <StatusView state={lc} treeDetails={treeDetails} submitError={submitError} />
          </div>
        </div>
      </div>

      {lc.kind === 'prompting' && (
        <ConsentModal
          sessionId={lc.sessionId}
          deadlineEpochMs={lc.deadlineEpochMs}
          onGrant={() => dispatch({ kind: 'consent:granted', sessionId: lc.sessionId })}
          onDeny={() => dispatch({ kind: 'consent:denied', sessionId: lc.sessionId })}
        />
      )}
      {lc.kind === 'archiving' && (
        <CaptureFlow
          sessionId={lc.sessionId}
          code={lc.code}
          deadlineEpochMs={lc.deadlineEpochMs}
          onUploaded={() => {
            // server transitions to resetting via /api/archive POST handler
          }}
          onFailed={() => dispatch({ kind: 'capture-failed', sessionId: lc.sessionId })}
        />
      )}
    </main>
  );
}

function StatusView({
  state,
  treeDetails,
  submitError,
}: {
  state: LifecycleState;
  treeDetails: TreeDetails;
  submitError: string | null;
}) {
  if (submitError) return <p className="error">Error: {submitError}</p>;

  switch (state.kind) {
    case 'idle':
      return <p className="muted">&nbsp;</p>;
    case 'querying': {
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
    case 'generating':
      return (
        <p>
          Display rendering
          {treeDetails ? ` — ${treeDetails.trees.length} real / ${treeDetails.fallbackSlots.length} fallback` : ''}
        </p>
      );
    case 'prompting':
      return <p className="muted">等待回覆…</p>;
    case 'archiving':
      return <p className="muted">拍照中…</p>;
    case 'resetting':
      return <p className="muted">完成。請輸入下一組代碼。</p>;
  }
}
