import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './ConsentModal.css';

type Props = {
  sessionId: string;
  deadlineEpochMs: number;
  onGrant: () => void;
  onDeny: () => void;
};

export function ConsentModal({ sessionId, deadlineEpochMs, onGrant, onDeny }: Props) {
  // Re-rendered ~10× / sec for the countdown number; tied to the session so a
  // late re-mount with a fresh deadline restarts the visual.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [sessionId]);

  // Click-outside / Escape are *not* handled — the spec calls for explicit
  // resolution only (button or server-side timeout).

  const remainingMs = Math.max(0, deadlineEpochMs - now);
  const seconds = Math.ceil(remainingMs / 1000);

  // Portal to document.body so the modal escapes the InputPage's
  // `.input > *:not(.bg-field) { position: relative; }` descendant rule,
  // which would otherwise drop our position:fixed back into document flow.
  return createPortal(
    <div className="consent-modal" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <span className="consent-countdown" aria-live="polite" aria-label={`${seconds} seconds remaining`}>
        {seconds}
      </span>
      <div className="consent-modal-content">
        <h2 id="consent-title" className="consent-title">
          Join Project?
        </h2>
        <p className="consent-sub">Please look towards the laptop camera</p>
        <div className="consent-actions">
          <button className="consent-btn consent-btn-primary" type="button" onClick={onGrant} autoFocus>
            Yes
          </button>
          <button className="consent-btn consent-btn-secondary" type="button" onClick={onDeny}>
            No
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
