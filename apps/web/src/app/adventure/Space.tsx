"use client";
// Deep space behind the globe: a twinkling starfield on a faint nebula in Backline's colours.
// A plain 2D canvas (cheap), drawn at a calm frame rate, paused when hidden or with reduced motion.
import { useEffect, useRef } from "react";

type Star = { x: number; y: number; r: number; a: number; tw: number; ph: number; hue: number };

export default function Space({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const seed = (() => {
      let s = 1337;
      return () => ((s = (s * 16807) % 2147483647) / 2147483647);
    })();
    const size = () => {
      w = c.clientWidth;
      h = c.clientHeight;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((w * h) / 2600);
      stars = Array.from({ length: n }, () => {
        const big = seed() < 0.06;
        return { x: seed() * w, y: seed() * h, r: big ? 0.9 + seed() * 1.1 : 0.25 + seed() * 0.7, a: 0.35 + seed() * 0.65, tw: 0.4 + seed() * 1.6, ph: seed() * 6.28, hue: seed() < 0.15 ? 220 : seed() < 0.25 ? 30 : 0 };
      });
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(c);
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 50) return; // ~20 fps is plenty for twinkling
      last = t;
      g.clearRect(0, 0, w, h);
      const time = t / 1000;
      const drift = reduce ? 0 : time * 2.5;
      for (const s of stars) {
        const x = (s.x + drift * (s.r * 0.6)) % w;
        const tw = reduce ? 1 : 0.65 + 0.35 * Math.sin(time * s.tw + s.ph);
        const alpha = s.a * tw;
        g.globalAlpha = alpha;
        g.fillStyle = s.hue ? `hsl(${s.hue}, 80%, 88%)` : "#fff";
        g.beginPath();
        g.arc(x, s.y, s.r, 0, Math.PI * 2);
        g.fill();
        if (s.r > 1) {
          g.globalAlpha = alpha * 0.18;
          g.beginPath();
          g.arc(x, s.y, s.r * 4, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    };
    if (active) raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active]);
  return (
    <div className={`eq-space${active ? "" : " is-gone"}`} aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
