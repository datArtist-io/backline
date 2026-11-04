// The trip's routes as part of the real 3D city: ribbons laid on the actual street height (measured
// from Google's 3D tiles by casting rays straight down), depth-tested against the buildings so a route
// passes behind a building instead of being painted across it. A flat map line drawn on top of a 3D
// city cut through every facade.
//
// Coordinates are Earth-centred (ECEF), the same frame as the tiles, each ribbon relative to its own
// origin so 32-bit vertex positions stay precise to the centimetre.
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

export type RibbonRoute = { day: number; color: string; geo: [number, number][] };

const rad = (d: number) => (d * Math.PI) / 180;
/** Points along a route are at most this far apart, so the ribbon follows the street's rises and dips. */
const STEP_M = 14;
const MAX_POINTS = 2000;
/** Height above the street, so the ribbon reads as lying on it without fighting the road surface. */
const LIFT_M = 1.6;
/** Ground samples taken per frame, so measuring never stutters the camera. */
const SAMPLES_PER_FRAME = 28;
/** Measure again this often: finer tiles arrive as the camera gets closer. */
const RESAMPLE_MS = 6000;

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _o = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _carto = { lat: 0, lon: 0, height: 0 } as { lat: number; lon: number; height: number };

/** A route as evenly spaced points (radians), at most STEP_M apart. Pure. */
export function densify(geo: [number, number][], step = STEP_M, max = MAX_POINTS): { lat: number[]; lon: number[]; along: number[] } {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < geo.length; i++) {
    const [ax, ay] = geo[i - 1];
    const [bx, by] = geo[i];
    const m = Math.hypot((bx - ax) * 111320 * Math.cos(rad(ay)), (by - ay) * 110574);
    seg.push(m);
    total += m;
  }
  const s = Math.max(step, total / max);
  const lat: number[] = [];
  const lon: number[] = [];
  const along: number[] = [];
  let run = 0;
  for (let i = 0; i < seg.length; i++) {
    const [ax, ay] = geo[i];
    const [bx, by] = geo[i + 1];
    const n = Math.max(1, Math.ceil(seg[i] / s));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      lat.push(rad(ay + (by - ay) * f));
      lon.push(rad(ax + (bx - ax) * f));
      along.push(total ? (run + seg[i] * f) / total : 0);
    }
    run += seg[i];
  }
  if (geo.length) {
    const [lx, ly] = geo[geo.length - 1];
    lat.push(rad(ly));
    lon.push(rad(lx));
    along.push(1);
  }
  return { lat, lon, along };
}

class Ribbon {
  readonly group = new THREE.Group();
  private readonly lat: Float64Array;
  private readonly lon: Float64Array;
  private readonly along: Float64Array;
  private readonly h: Float64Array;
  private readonly measured: Uint8Array;
  private readonly core: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly trail: THREE.Mesh;
  private readonly corePos: THREE.BufferAttribute;
  private readonly glowPos: THREE.BufferAttribute;
  private width = 0;
  dirty = true;

  constructor(readonly day: number, color: string, geo: [number, number][], ground: number) {
    const d = densify(geo);
    const n = d.lat.length;
    this.lat = Float64Array.from(d.lat);
    this.lon = Float64Array.from(d.lon);
    this.along = Float64Array.from(d.along);
    this.h = new Float64Array(n).fill(ground);
    this.measured = new Uint8Array(n);
    WGS84_ELLIPSOID.getCartographicToPosition(this.lat[0], this.lon[0], ground, _o);
    this.group.position.copy(_o);
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    const make = (pos: THREE.BufferAttribute) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", pos);
      g.setIndex(index);
      return g;
    };
    this.corePos = new THREE.BufferAttribute(new Float32Array(n * 6), 3);
    this.glowPos = new THREE.BufferAttribute(new Float32Array(n * 6), 3);
    const mat = (c: string, opacity: number, offset: number) =>
      new THREE.MeshBasicMaterial({ color: new THREE.Color(c), transparent: true, opacity, depthTest: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset * 2 });
    this.glow = new THREE.Mesh(make(this.glowPos), mat(color, 0.3, 2));
    this.core = new THREE.Mesh(make(this.corePos), mat(color, 0.95, 4));
    // The stretch already flown, in white over the route: same points, drawn up to the progress.
    this.trail = new THREE.Mesh(make(this.corePos), mat("#ffffff", 1, 6));
    this.trail.geometry.setDrawRange(0, 0);
    this.glow.renderOrder = 1;
    this.core.renderOrder = 2;
    this.trail.renderOrder = 3;
    for (const m of [this.glow, this.core, this.trail]) m.frustumCulled = false;
    this.group.add(this.glow, this.core, this.trail);
  }

  get length() {
    return this.lat.length;
  }

  /** Measure the street height under a point from the loaded tiles; false when nothing is loaded there yet. */
  measure(i: number, tiles: THREE.Object3D, ray: THREE.Raycaster): boolean {
    WGS84_ELLIPSOID.getCartographicToPosition(this.lat[i], this.lon[i], this.h[i] + 1500, _v);
    WGS84_ELLIPSOID.getCartographicToNormal(this.lat[i], this.lon[i], _n);
    const m = tiles.matrixWorld;
    _v.applyMatrix4(m);
    _n.transformDirection(m).negate();
    ray.set(_v, _n);
    ray.far = 4000;
    const hits = ray.intersectObject(tiles, true);
    if (!hits.length) return false;
    // The last surface the ray meets is the street (the first can be a roof the route passes beside).
    const p = hits[hits.length - 1].point.applyMatrix4(_inv.copy(m).invert());
    WGS84_ELLIPSOID.getPositionToCartographic(p, _carto);
    if (!Number.isFinite(_carto.height) || Math.abs(_carto.height - this.h[i]) > 3000) return false;
    if (Math.abs(_carto.height - this.h[i]) > 0.3) this.dirty = true;
    this.h[i] = _carto.height;
    this.measured[i] = 1;
    return true;
  }

  /** Lay the two ribbons (core and glow) along the measured street at this width in metres. */
  build(width: number) {
    if (!this.dirty && Math.abs(width - this.width) < this.width * 0.25) return;
    this.width = width;
    this.dirty = false;
    const n = this.lat.length;
    const p: THREE.Vector3[] = [];
    const up: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      WGS84_ELLIPSOID.getCartographicToPosition(this.lat[i], this.lon[i], this.h[i] + LIFT_M, _v);
      p.push(_v.clone().sub(this.group.position));
      WGS84_ELLIPSOID.getCartographicToNormal(this.lat[i], this.lon[i], _n);
      up.push(_n.clone());
    }
    const side = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const write = (attr: THREE.BufferAttribute, w: number) => {
      for (let i = 0; i < n; i++) {
        dir.subVectors(p[Math.min(n - 1, i + 1)], p[Math.max(0, i - 1)]);
        side.crossVectors(dir, up[i]).normalize().multiplyScalar(w / 2);
        attr.setXYZ(2 * i, p[i].x + side.x, p[i].y + side.y, p[i].z + side.z);
        attr.setXYZ(2 * i + 1, p[i].x - side.x, p[i].y - side.y, p[i].z - side.z);
      }
      attr.needsUpdate = true;
    };
    write(this.corePos, width);
    write(this.glowPos, width * 3.2);
  }

  setLook(state: "on" | "dim" | "hidden") {
    this.group.visible = state !== "hidden";
    (this.core.material as THREE.MeshBasicMaterial).opacity = state === "dim" ? 0.14 : 0.95;
    (this.glow.material as THREE.MeshBasicMaterial).opacity = state === "dim" ? 0.04 : 0.3;
  }

  /** Paint the flown stretch, 0 to 1 along the route; null clears it. */
  setProgress(t: number | null) {
    if (t == null) return this.trail.geometry.setDrawRange(0, 0);
    let k = 0;
    while (k < this.along.length - 1 && this.along[k + 1] <= t) k++;
    this.trail.geometry.setDrawRange(0, Math.max(0, k) * 6);
  }

  dispose() {
    for (const m of [this.glow, this.core, this.trail]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** Every day's route as ribbons, measured onto the real streets a few points per frame. */
export class RouteRibbons {
  readonly root = new THREE.Group();
  private ribbons: Ribbon[] = [];
  private queue: [Ribbon, number][] = [];
  private nextPass = 0;
  private active: number | "all" = "all";
  private flying: number | null = null;
  private readonly ray = new THREE.Raycaster();

  setRoutes(routes: RibbonRoute[], ground: number) {
    for (const r of this.ribbons) {
      this.root.remove(r.group);
      r.dispose();
    }
    this.ribbons = routes.filter((r) => r.geo.length >= 2).map((r) => new Ribbon(r.day, r.color, r.geo, ground));
    for (const r of this.ribbons) this.root.add(r.group);
    this.queue = [];
    this.nextPass = 0;
    this.look();
  }

  setActiveDay(day: number | "all") {
    this.active = day;
    this.look();
  }

  /** While a day is flown, only its route shows, with the flown stretch in white. */
  setProgress(day: number | null, t: number | null) {
    this.flying = day;
    for (const r of this.ribbons) r.setProgress(r.day === day ? t : null);
    this.look();
  }

  private look() {
    for (const r of this.ribbons) {
      const on = this.flying != null ? r.day === this.flying : this.active === "all" || r.day === this.active;
      r.setLook(on ? "on" : this.flying != null ? "hidden" : "dim");
    }
  }

  /** Measure a few more points and rebuild what changed; width follows the zoom (metres per pixel). */
  update(tiles: THREE.Object3D, metresPerPixel: number, now: number) {
    if (!this.ribbons.length) return;
    if (!this.queue.length && now >= this.nextPass) {
      // Visible days first, so the route on screen settles soonest.
      const order = [...this.ribbons].sort((a, b) => Number(b.group.visible) - Number(a.group.visible));
      for (const r of order) for (let i = 0; i < r.length; i++) this.queue.push([r, i]);
      this.nextPass = now + RESAMPLE_MS;
    }
    for (let k = 0; k < SAMPLES_PER_FRAME && this.queue.length; k++) {
      const [r, i] = this.queue.shift()!;
      if (r.group.visible) r.measure(i, tiles, this.ray);
    }
    const width = Math.min(400, Math.max(3.5, metresPerPixel * 5));
    for (const r of this.ribbons) if (r.group.visible) r.build(width);
  }

  dispose() {
    this.setRoutes([], 0);
  }
}
