"use client";

import { useState } from "react";

type HoverZoomImageProps = {
  src: string;
  alt: string;
  thumbClassName: string;
  previewWidth?: number;
};

export function HoverZoomImage({ src, alt, thumbClassName, previewWidth = 460 }: HoverZoomImageProps) {
  const [visible, setVisible] = useState(false);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);

  function updatePosition(clientX: number, clientY: number): void {
    const margin = 24;
    const width = previewWidth;
    const maxLeft = typeof window !== "undefined" ? window.innerWidth - width - margin : 1000;
    const nextLeft = Math.max(margin, Math.min(clientX + 18, maxLeft));
    const nextTop = Math.max(margin, clientY - 180);
    setX(nextLeft);
    setY(nextTop);
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={thumbClassName}
        onMouseEnter={(e) => {
          setVisible(true);
          updatePosition(e.clientX, e.clientY);
        }}
        onMouseMove={(e) => updatePosition(e.clientX, e.clientY)}
        onMouseLeave={() => setVisible(false)}
      />
      {visible ? (
        <div
          className="pointer-events-none fixed z-[100] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_80px_rgba(15,23,42,0.34)]"
          style={{ left: x, top: y, width: previewWidth }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="h-auto max-h-[72vh] w-full rounded-xl object-contain" />
        </div>
      ) : null}
    </>
  );
}
