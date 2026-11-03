// Where to look from when loading a trip's 3D city ahead of time. Pure, so it is tested.
import type { DayRoute } from "./model";
import type { PreloadView } from "./photoreal";

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Viewpoints along every day's route, every few hundred metres, each facing the way the route goes,
 * so loading them covers what Fly the trip will show. Spread evenly, at most `max`. Pure.
 */
export function tripViews(routes: Pick<DayRoute, "geo">[], max = 160): PreloadView[] {
  const segs: { a: [number, number]; b: [number, number]; m: number }[] = [];
  for (const r of routes) {
    for (let i = 1; i < r.geo.length; i++) {
      const a = r.geo[i - 1] as [number, number];
      const b = r.geo[i] as [number, number];
      const m = Math.hypot((b[0] - a[0]) * 111320 * Math.cos(rad(a[1])), (b[1] - a[1]) * 110574);
      if (m > 0) segs.push({ a, b, m });
    }
  }
  const total = segs.reduce((n, x) => n + x.m, 0);
  if (!total) return [];
  const step = Math.max(450, total / max);
  const out: PreloadView[] = [];
  let next = 0;
  let run = 0;
  for (const { a, b, m } of segs) {
    const bearing = ((Math.atan2((b[0] - a[0]) * Math.cos(rad(a[1])), b[1] - a[1]) * 180) / Math.PI + 360) % 360;
    while (next <= run + m && out.length < max) {
      const f = (next - run) / m;
      out.push({ lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, bearing });
      next += step;
    }
    run += m;
  }
  return out;
}
