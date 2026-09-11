import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { useI18n } from '../../i18n/index.js';
import { Sheet } from '../../design-system/Sheet.js';
import { Row } from '../../design-system/Stack.js';
import { Banner } from '../../design-system/Feedback.js';

/**
 * "Pagar com QR" -- scans a charge's QR code (the same one Receive/PaymentRequestDetailSheet
 * shows the requester) using the device's own camera, entirely client-side (a canvas frame +
 * `jsqr`, no network call, no external service ever sees the camera feed). Only ever extracts the
 * request ID text encoded in the QR -- the same string the manual "Buscar" field already accepts,
 * never a shortcut around the real lookup/pay flow.
 */
export function QrScannerSheet({ onScanned, onClose }: { onScanned: (text: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number | undefined;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA && ctx && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          cancelled = true;
          onScanned(code.data);
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        // Denied permission, no camera device, or a non-HTTPS/insecure context (getUserMedia
        // requires one) -- fails soft, the manual "Buscar" field remains fully usable either way.
        if (!cancelled) setError(t('send', 'cameraUnavailable'));
      }
    }

    start();
    return () => {
      cancelled = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet onDismiss={onClose}>
      <Row justify="space-between">
        <span style={{ fontWeight: 700 }}>{t('send', 'scanQrTitle')}</span>
        <button onClick={onClose} aria-label={t('common', 'close')} style={{ background: 'none', border: 'none', fontSize: 20 }}>
          ✕
        </button>
      </Row>
      {error ? (
        <Banner tone="danger">{error}</Banner>
      ) : (
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 'var(--radius-md)', background: '#000' }}
        />
      )}
      <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{t('send', 'scanQrHint')}</p>
    </Sheet>
  );
}
