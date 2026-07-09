'use client';

import { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';

/**
 * QR card that opens the guest link for this stream. Shown on the desktop
 * stage (host + guest views). The URL needs window.location.origin, which
 * only exists in the browser — computed after mount to avoid a hydration
 * mismatch.
 */
export default function JoinQr({ channelId }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (channelId && typeof window !== 'undefined') {
      setUrl(`${window.location.origin}/stream/${channelId}`);
    }
  }, [channelId]);

  if (!url) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
      padding: '10px 10px 8px', background: 'var(--panel)',
      border: '1px solid var(--line-3)', borderRadius: 12,
    }}>
      <QRCode value={url} size={96} bgColor="#ffffff" fgColor="#0B0B0B" />
      <span className="mono" style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: 'var(--faint)' }}>
        SCAN TO JOIN
      </span>
    </div>
  );
}
