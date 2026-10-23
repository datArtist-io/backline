"use client";
// "Check with me / Just do it" switch. A single glass thumb slides between the options.
import { useRef } from "react";

export type Autonomy = "check" | "auto";
const OPTIONS: { value: Autonomy; label: string; hint: string }[] = [
  { value: "check", label: "Check with me", hint: "The agent stops for your call on key decisions" },
  { value: "auto", label: "Just do it", hint: "The agent makes every call and runs end to end" },
];

export default function ModeSwitch({ value, onChange, className = "" }: { value: Autonomy; onChange: (v: Autonomy) => void; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = OPTIONS.findIndex((o) => o.value === value);
  const move = (i: number) => {
    const next = (i + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={`switch ${className}`} role="radiogroup" aria-label="How much the agent checks with you" data-pos={idx}>
      <span className="switch-thumb" aria-hidden="true" />
      {OPTIONS.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          title={o.hint}
          className={`switch-opt${value === o.value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(i + 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(i - 1);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
