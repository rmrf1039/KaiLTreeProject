/**
 * Lazy webcam access. The MediaDevices stream is acquired *only* when
 * `acquireCamera()` is called — never on mount, never on import — satisfying
 * the privacy-by-design requirement that the camera is not pre-initialized.
 *
 * Returns the stream to the caller; ownership stays with the caller. This
 * shape (instead of a hook with a global stream ref) makes React StrictMode's
 * double-mount in dev safe: the cleanup pass stops the right stream because
 * the caller can hold a per-mount local reference.
 */
export async function acquireCamera(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('media-devices-unavailable');
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
}

export function releaseStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

export type CapturedImage = { blob: Blob; mimeType: 'image/webp' | 'image/jpeg' };

/**
 * Re-encode a video frame to a fresh image blob via canvas. The canvas pipeline
 * paints raw pixels, so the resulting blob carries no EXIF / source metadata
 * by construction — the privacy guarantee for the archive endpoint.
 *
 * Tries WebP first (smaller payload). If the browser doesn't actually support
 * WebP encoding (some Safari versions, some older Firefox), `toBlob` either
 * returns null or silently produces a PNG; in both cases we fall back to JPEG,
 * which every browser that ships canvas.toBlob supports.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  quality = 0.85,
): Promise<CapturedImage | null> {
  const webp = await encodeFrame(video, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') {
    return { blob: webp, mimeType: 'image/webp' };
  }
  const jpeg = await encodeFrame(video, 'image/jpeg', quality);
  if (jpeg && jpeg.type === 'image/jpeg') {
    return { blob: jpeg, mimeType: 'image/jpeg' };
  }
  return null;
}

function encodeFrame(
  video: HTMLVideoElement,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      resolve(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob((b) => resolve(b), mimeType, quality);
  });
}
