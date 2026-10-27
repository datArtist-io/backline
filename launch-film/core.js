// Shared timing, easing and spring maths for the Backline launch film.
// Every value on screen is a pure function of time t (seconds): no timers, no state between frames.

const BPM = window.FILM_BPM || 120;
const OFFSET = window.FILM_OFFSET || 0; // seconds before beat 0 (music lead-in)
const SPB = 60 / BPM;
/** Time of beat n (quarter notes from the film's beat 0). */
const B = (n) => OFFSET + n * SPB;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const smooth = (k) => k * k * (3 - 2 * k);
const eOut = (k) => 1 - Math.pow(1 - k, 3);
const eOut5 = (k) => 1 - Math.pow(1 - k, 5);
const eIn = (k) => k * k * k;
const eInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const eExpo = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
/** Progress 0..1 of [a, b] at t with an easing. */
const P = (t, a, b, e = eOut) => e(inv(a, b, t));

/**
 * Closed-form spring step response from 0 to 1, started at t0. Slightly underdamped: a tiny
 * overshoot at most (zeta 0.82). w is the natural frequency (rad/s).
 */
function springStep(t, t0, w = 16, z = 0.82) {
  const x = t - t0;
  if (x <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + ((z * w) / wd) * Math.sin(wd * x));
}

/** A value with many targets: [[t, value], ...], one spring per change, so still a pure function. */
function track(t, keys, w = 16, z = 0.82) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * springStep(t, keys[i][0], keys[i][2] || w, z);
  return v;
}

/** Same, eased instead of sprung (for camera-like moves): [[t, v, dur?, ease?]]. */
function etrack(t, keys) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t0, val, d = 0.6, e = eInOut] = keys[i];
    v += (val - keys[i - 1][1]) * e(inv(t0, t0 + d, t));
  }
  return v;
}

/** Piecewise path for the cursor: [[t, x, y], ...], eased between points. */
function path(t, pts, e = eInOut) {
  if (t <= pts[0][0]) return [pts[0][1], pts[0][2]];
  for (let i = 1; i < pts.length; i++) {
    const [t1, x1, y1] = pts[i];
    const [t0, x0, y0] = pts[i - 1];
    if (t <= t1) {
      const k = e(inv(t0, t1, t));
      return [lerp(x0, x1, k), lerp(y0, y1, k)];
    }
  }
  const l = pts[pts.length - 1];
  return [l[1], l[2]];
}

/** Style helper. */
function css(el, o) {
  for (const k in o) {
    const v = o[k];
    if (k.startsWith("--")) el.style.setProperty(k, v);
    else el.style[k] = v;
  }
}

/** Show an element only inside [a, b). */
const live = (t, a, b) => t >= a && t < b;

/** Typewriter: characters of s typed from t0 at cps chars per second. */
const typed = (t, t0, s, cps = 22) => s.slice(0, Math.max(0, Math.floor((t - t0) * cps)));

/** Count up a number from a to b over [t0, t1]. */
const count = (t, t0, t1, a, b) => lerp(a, b, eOut(inv(t0, t1, t)));

const fmtUSD = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
