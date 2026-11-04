// The plane that flies the journey in: the simple white jet, nose to the north (the marker turns it to
// its heading), with a soft shadow that drifts off as it climbs. The white contrail behind it is the
// map's "arc" line.
export function planeHtml(): string {
  return `<div class="eq-plane-shadow" aria-hidden="true"></div><div class="eq-plane"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 1.6c.9 0 1.5 1.1 1.5 2.4v5.3l8 4.7v2.2l-8-2.4v4.8l2.6 2v1.7L12 21.2l-4.1 1.1v-1.7l2.6-2v-4.8l-8 2.4V14l8-4.7V4c0-1.3.6-2.4 1.5-2.4z" fill="currentColor"/></svg></div>`;
}

/** Turns toward a new heading the short way round, a fraction per frame, so the plane never snaps. Pure. */
export function easeHeading(current: number, target: number, k: number): number {
  const d = ((target - current + 540) % 360) - 180;
  return (current + d * Math.max(0, Math.min(1, k)) + 360) % 360;
}
