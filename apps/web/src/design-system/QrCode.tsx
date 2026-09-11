import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Renders `value` as a QR code, generated entirely client-side (no external service call -- the value never leaves the device just to be turned into an image). */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#17171f', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) return <div style={{ width: size, height: size, background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }} />;
  return <img src={dataUrl} alt="QR code" width={size} height={size} style={{ borderRadius: 'var(--radius-sm)', display: 'block' }} />;
}
