import { useId } from "react";

/** The Backline mark: three stacked bars — an amp stack, a rising level, the crew lined up behind the artist. */
export function Mark({ size = 28, mono }: { size?: number; mono?: string }) {
  const id = useId().replace(/:/g, "");
  const fill = mono ?? `url(#gel-${id})`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`gel-${id}`} x1="8" y1="6" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff4fa3" />
          <stop offset="0.5" stopColor="#7b5cff" />
          <stop offset="1" stopColor="#38d3ff" />
        </linearGradient>
      </defs>
      <rect x="5" y="9" width="30" height="12" rx="6" fill={fill} />
      <rect x="5" y="26" width="42" height="12" rx="6" fill={fill} />
      <rect x="5" y="43" width="54" height="12" rx="6" fill={fill} />
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="logo">
      <Mark size={size} />
      <span className="logo-word">backline</span>
    </span>
  );
}
