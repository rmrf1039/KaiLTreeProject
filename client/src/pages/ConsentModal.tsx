import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './ConsentModal.css';

type Props = {
  sessionId: string;
  deadlineEpochMs: number;
  onGrant: () => void;
  onDeny: () => void;
};

const RING_RADIUS = 28;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
// Mirrors PROMPTING_TIMEOUT_MS in /server/src/lifecycle.ts. Kept duplicated
// because the deadline arrives as an absolute epoch — the duration is only
// needed for the ring-fill ratio.
const PROMPTING_TOTAL_MS = 30_000;

export function ConsentModal({ sessionId, deadlineEpochMs, onGrant, onDeny }: Props) {
  // Re-rendered ~10× / sec for the countdown ring; tied to the session so a
  // late re-mount with a fresh deadline restarts the visual.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [sessionId]);

  // Click-outside / Escape are *not* handled — the spec calls for explicit
  // resolution only (button or server-side timeout).

  const remainingMs = Math.max(0, deadlineEpochMs - now);
  const fraction = Math.max(0, Math.min(1, remainingMs / PROMPTING_TOTAL_MS));
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction);
  const seconds = Math.ceil(remainingMs / 1000);

  // Portal to document.body so the modal escapes the InputPage's
  // `.input > *:not(.bg-field) { position: relative; }` descendant rule,
  // which would otherwise drop our position:fixed back into document flow.
  return createPortal(
    <div className="consent-modal" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="consent-modal-content">
        <div className="consent-ring-wrap" aria-hidden="true">
          <svg className="consent-ring" viewBox="0 0 64 64">
            <circle className="consent-ring-track" cx="32" cy="32" r={RING_RADIUS} />
            <circle
              className="consent-ring-progress"
              cx="32"
              cy="32"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <span className="consent-ring-num">{seconds}</span>
        </div>
        <h2 id="consent-title" className="consent-title">
          要與您的樹合影嗎？
        </h2>
        <p className="consent-sub">將開啟相機，僅用於拍攝這張照片並加入檔案樹。</p>
        <div className="consent-actions">
          <button className="consent-btn consent-btn-primary" type="button" onClick={onGrant} autoFocus>
            拍照留念
          </button>
          <button className="consent-btn consent-btn-secondary" type="button" onClick={onDeny}>
            略過
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
