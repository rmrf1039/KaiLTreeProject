import { useEffect, useRef } from 'react';

type FsDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function inFullscreen(): boolean {
  const doc = document as FsDocument;
  return !!(document.fullscreenElement ?? doc.webkitFullscreenElement);
}

function requestFs(): void {
  const root = document.documentElement as FsElement;
  const req = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
  try {
    const r = req?.();
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function exitFs(): void {
  const doc = document as FsDocument;
  const exit = doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc);
  try {
    const r = exit?.();
    if (r && typeof (r as Promise<void>).catch === 'function') {
      (r as Promise<void>).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/**
 * Cmd/Ctrl+F toggles browser fullscreen, with Safari workaround.
 *
 * macOS Safari silently exits element-fullscreen when a text input is
 * focused, even though documentElement is fullscreen. We track the user's
 * intent (entered via Cmd+F, exited via Cmd+F or Esc) and re-enter on the
 * next click whenever Safari drops out unexpectedly.
 */
export function useFullscreenShortcut(): void {
  const wantFsRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && wantFsRef.current) {
        // Esc is the browser's native fullscreen exit — respect it.
        wantFsRef.current = false;
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      if (inFullscreen()) {
        wantFsRef.current = false;
        exitFs();
      } else {
        wantFsRef.current = true;
        requestFs();
      }
    };

    const onClick = () => {
      // Re-enter if Safari (or anything else) dropped fullscreen without
      // the user explicitly asking. Click counts as a user gesture, so
      // requestFullscreen will be honored.
      if (wantFsRef.current && !inFullscreen()) requestFs();
    };

    const onFsChange = () => {
      if (inFullscreen()) wantFsRef.current = true;
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);
}
