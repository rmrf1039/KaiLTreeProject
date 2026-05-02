import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { acquireCamera, captureFrame, releaseStream } from './useCamera';
import './CaptureFlow.css';

type Props = {
  sessionId: string;
  code: string;
  deadlineEpochMs: number;
  onUploaded: () => void;
  onFailed: () => void;
};

type Phase =
  | { kind: 'starting' }
  | { kind: 'countdown'; n: number }
  | { kind: 'flash' }
  | { kind: 'uploading' }
  | { kind: 'error'; message: string };

const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1_000;
const FLASH_MS = 220;

export function CaptureFlow({ sessionId, code, onUploaded, onFailed }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const failedRef = useRef(false);

  function fail(msg: string): void {
    if (failedRef.current) return;
    failedRef.current = true;
    setPhase({ kind: 'error', message: msg });
    window.setTimeout(() => onFailed(), 1500);
  }

  // Acquire the camera the moment this component mounts (consent has already
  // been granted by the time we reach the `archiving` lifecycle state). The
  // stream is owned by this effect — local to its closure — so React 18
  // StrictMode's mount → cleanup → mount in dev releases the right stream.
  useEffect(() => {
    let cancelled = false;
    let localStream: MediaStream | null = null;

    void acquireCamera()
      .then((stream) => {
        localStream = stream;
        if (cancelled) {
          releaseStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {
            /* autoplay is allowed — consent-button gesture preceded mount */
          });
        }
        setPhase({ kind: 'countdown', n: COUNTDOWN_FROM });
      })
      .catch((err) => {
        if (cancelled) return;
        fail((err as Error).message ?? 'camera-denied');
      });

    return () => {
      cancelled = true;
      releaseStream(localStream);
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive countdown → flash → capture.
  useEffect(() => {
    if (phase.kind !== 'countdown') return;
    if (phase.n === 0) {
      setPhase({ kind: 'flash' });
      window.setTimeout(() => void doCapture(), FLASH_MS);
      return;
    }
    const id = window.setTimeout(() => {
      setPhase({ kind: 'countdown', n: phase.n - 1 });
    }, COUNTDOWN_STEP_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind === 'countdown' ? phase.n : phase.kind]);

  async function doCapture(): Promise<void> {
    const video = videoRef.current;
    if (!video) {
      fail('no-video');
      return;
    }
    const captured = await captureFrame(video, 0.85);
    if (!captured) {
      fail('encode-unsupported');
      return;
    }
    setPhase({ kind: 'uploading' });
    try {
      const r = await fetch(
        `/api/archive?sessionId=${encodeURIComponent(sessionId)}&code=${encodeURIComponent(code)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': captured.mimeType },
          body: captured.blob,
        },
      );
      if (!r.ok) {
        const err = (await r.json().catch(() => ({ error: 'upload-failed' }))) as { error?: string };
        fail(err.error ?? `HTTP ${r.status}`);
        return;
      }
      onUploaded();
    } catch (err) {
      fail((err as Error).message);
    }
  }

  return createPortal(
    <div className="capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title">
      <div className="capture-modal-content">
        <h2 id="capture-title" className="capture-title">
          {phase.kind === 'uploading' ? '上傳中…' : phase.kind === 'error' ? '無法拍攝' : '請看鏡頭'}
        </h2>
        <div className="capture-frame">
          <video ref={videoRef} className="capture-video" muted playsInline autoPlay />
          {phase.kind === 'countdown' && phase.n > 0 && (
            <div className="capture-countdown" aria-live="polite">
              {phase.n}
            </div>
          )}
          {phase.kind === 'flash' && <div className="capture-flash" aria-hidden="true" />}
          {phase.kind === 'uploading' && <div className="capture-uploading" aria-hidden="true" />}
        </div>
        {phase.kind === 'error' && <p className="capture-error">{phase.message}</p>}
      </div>
    </div>,
    document.body,
  );
}
