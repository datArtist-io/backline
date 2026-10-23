"use client";

import { useEffect } from "react";

// SVG refraction filter for liquid glass. Chromium browsers can apply SVG filters through
// backdrop-filter, so we switch refraction on only there; every other browser keeps the
// blur, tint and highlight layers, which still read as glass.
export default function GlassFilter() {
  useEffect(() => {
    const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
    const chromium = Boolean(brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand)));
    const reduced = window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
    if (chromium && !reduced) document.documentElement.classList.add("refract");
  }, []);

  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <filter id="lg-refract" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="2" seed="11" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2.5" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale="42" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
