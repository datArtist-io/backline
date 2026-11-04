// The airliner that flies the journey in: a top-down jet drawn as SVG, nose to the north (the marker
// turns it to its heading). Shaded fuselage and wings, two engines, a tail in Backline's colours, and
// the navigation lights real aircraft carry: red on the left wingtip, green on the right, a white strobe
// on the tail. Its shadow is the same silhouette, softened, drifting off as it climbs.

/** The jet's outline, shared by the plane and its shadow. viewBox 0 0 100 100, nose at the top. */
const BODY = "M50 3.5c3.3 0 5 4.6 5 11.2V40l39 19.6v5.6L55 57.4v20.4l11 7.4v4.6L50 86.4l-16 3.4v-4.6l11-7.4V57.4L6 65.2v-5.6L45 40V14.7c0-6.6 1.7-11.2 5-11.2z";

export function planeHtml(): string {
  return `<div class="eq-plane-shadow" aria-hidden="true"><svg viewBox="0 0 100 100"><path d="${BODY}"/></svg></div>
<div class="eq-plane" aria-hidden="true"><svg viewBox="0 0 100 100">
  <defs>
    <linearGradient id="pl-body" x1="0" x2="1">
      <stop offset="0" stop-color="#c9d2e3"/><stop offset=".35" stop-color="#ffffff"/><stop offset=".6" stop-color="#f4f7fc"/><stop offset="1" stop-color="#aeb9cf"/>
    </linearGradient>
    <linearGradient id="pl-wing" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#e3e9f4"/><stop offset="1" stop-color="#b9c4d8"/>
    </linearGradient>
    <linearGradient id="pl-tail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7b5cff"/><stop offset=".55" stop-color="#ff4fa3"/><stop offset="1" stop-color="#ff9a3c"/>
    </linearGradient>
    <radialGradient id="pl-engine" cx=".5" cy=".3" r=".7">
      <stop offset="0" stop-color="#f3f6fb"/><stop offset="1" stop-color="#8f9bb3"/>
    </radialGradient>
  </defs>
  <!-- wings and tailplane -->
  <path d="M45 40L6 59.6v5.6L45 57.4zM55 40l39 19.6v5.6L55 57.4z" fill="url(#pl-wing)"/>
  <path d="M45 77.8l-11 7.4v4.6l11-2.4zM55 77.8l11 7.4v4.6l-11-2.4z" fill="url(#pl-wing)"/>
  <!-- flap lines -->
  <path d="M44.5 55.6L14 61.6M55.5 55.6L86 61.6" stroke="#9aa6bd" stroke-width=".6" fill="none" opacity=".7"/>
  <!-- engines -->
  <rect x="24.2" y="44.5" width="6.2" height="13" rx="3" fill="url(#pl-engine)"/>
  <rect x="69.6" y="44.5" width="6.2" height="13" rx="3" fill="url(#pl-engine)"/>
  <ellipse cx="27.3" cy="45.2" rx="2.4" ry="1" fill="#3a4258"/>
  <ellipse cx="72.7" cy="45.2" rx="2.4" ry="1" fill="#3a4258"/>
  <!-- fuselage -->
  <path d="M50 3.5c3.3 0 5 4.6 5 11.2v63.1c0 5-2.2 8.8-5 10.8-2.8-2-5-5.8-5-10.8V14.7c0-6.6 1.7-11.2 5-11.2z" fill="url(#pl-body)"/>
  <!-- cockpit -->
  <path d="M47.4 10.4c1.6-1.2 3.6-1.2 5.2 0l-.5 1.9c-1.4-.8-2.8-.8-4.2 0z" fill="#26304a"/>
  <!-- the fin, in Backline's colours, along the spine -->
  <path d="M48.8 70h2.4l.6 16.6c-.8.9-2.8.9-3.6 0z" fill="url(#pl-tail)"/>
  <!-- navigation lights -->
  <circle class="pl-red" cx="6.6" cy="62.2" r="1.6" fill="#ff3b4a"/>
  <circle class="pl-green" cx="93.4" cy="62.2" r="1.6" fill="#2bff88"/>
  <circle class="pl-strobe" cx="50" cy="88.2" r="1.4" fill="#ffffff"/>
</svg></div>`;
}

/** Turns toward a new heading the short way round, a fraction per frame, so the plane never snaps. Pure. */
export function easeHeading(current: number, target: number, k: number): number {
  const d = ((target - current + 540) % 360) - 180;
  return (current + d * Math.max(0, Math.min(1, k)) + 360) % 360;
}
