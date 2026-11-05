'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Ruhezone um den Code in Modulen (Norm: mindestens 4) */
const QUIET = 4;

/**
 * QR-Code als SVG, im Browser erzeugt (`qrcode-generator`, ohne Abhängigkeiten). Der Inhalt (`sg://pair?…` mit
 * dem Code) verlässt den Mac dadurch nicht. Immer dunkel auf weiß, auch im Dunkelmodus: Kameras lesen
 * invertierte Codes oft nicht. Fehlerkorrektur M reicht für einen Bildschirm.
 */
export function PairingQr({ value, label, size = 224 }: { value: string; label: string; size?: number }) {
  const { count, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
      }
    }
    return { count: n + QUIET * 2, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${count} ${count}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="block h-auto w-full rounded-md"
      data-testid="pairing-qr"
    >
      <rect width={count} height={count} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
