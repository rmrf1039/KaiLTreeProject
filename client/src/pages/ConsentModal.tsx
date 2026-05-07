import { createPortal } from 'react-dom';
import './ConsentModal.css';

type Props = {
  onGrant: () => void;
  onDeny: () => void;
};

export function ConsentModal({ onGrant, onDeny }: Props) {
  // Click-outside / Escape are *not* handled — only the buttons resolve the modal.

  // Portal to document.body so the modal escapes the InputPage's
  // `.input > *:not(.bg-field) { position: relative; }` descendant rule,
  // which would otherwise drop our position:fixed back into document flow.
  return createPortal(
    <div className="consent-modal" role="dialog" aria-modal="true" aria-labelledby="consent-title">
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
