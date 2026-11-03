// Google's Photorealistic 3D Tiles (the data behind Google Earth) inside the MapLibre map: real
// buildings, roofs, trees and terrain, textured from aerial photography. Rendered by three.js through
// a MapLibre custom layer that shares the map's camera, so pins and routes stay on top of the real city.
// Needs NEXT_PUBLIC_GOOGLE_MAPS_KEY with the Map Tiles API enabled.
import * as THREE from "three";
import type { CustomLayerInterface, Map as MlMap } from "maplibre-gl";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin, GoogleCloudAuthPlugin, TileCompressionPlugin, UnloadTilesPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const mercY = (lat: number) => deg(Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2)));

// Our scene's axes: x east, y up, z south. The ellipsoid's local frame is x east, y north, z up.
/** Offsets in metres for the ground probe: a 3x3 grid across a city block or two. */
const PROBE = [-140, 0, 140];
const DOWN = new THREE.Vector3(0, -1, 0);

/** The camera Fly the trip uses (Earth.tsx), so the trip can be loaded from the same views ahead of time. */
export const FLY_ZOOM = 16.1;
export const FLY_PITCH = 64;
/** How many viewpoints load at once while preparing a trip. */
const PRELOAD_BATCH = 8;
/** How far a virtual camera loads: the street ahead and a couple of blocks beyond, not the horizon. */
const PRELOAD_FAR_M = 2500;

/** A viewpoint along the trip: where the camera looks and which way it faces. */
export type PreloadView = { lat: number; lon: number; bearing: number };

/** Phones get the library's defaults; a laptop or desktop keeps a whole trip's city in memory. */
const roomy = () => typeof navigator !== "undefined" && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const GB = 2 ** 30;

const ENU_TO_LOCAL = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);

export class PhotorealLayer implements CustomLayerInterface {
  id = "photoreal";
  type = "custom" as const;
  renderingMode = "3d" as const;
  enabled = false;
  map!: MlMap;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.Camera();
  lod = new THREE.PerspectiveCamera(37, 1, 1, 4e7);
  holder = new THREE.Group();
  tiles!: TilesRenderer;
  /** Metres to drop the tiles by so the real ground under the map's centre sits at the map's zero. */
  groundOffset = 0;
  private lastProbe = 0;
  // Preparing a trip: viewpoints still to load, the ones loading now, and how far along it is.
  private queue: PreloadView[] = [];
  private batch: { cam: THREE.PerspectiveCamera; v: PreloadView }[] = [];
  private total = 0;
  private loadedViews = 0;
  private quiet = 0;
  private batchAt = 0;
  private onPreload?: (fraction: number) => void;
  private pumping = 0;
  private enu = new THREE.Matrix4();
  private ray = new THREE.Raycaster();

  constructor(private key: string, private onCredit: (text: string) => void, private onFail?: () => void) {
    this.holder.matrixAutoUpdate = false;
    this.scene.add(this.holder);
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Unpacking tiles was the bottleneck (5 at a time, hundreds waiting): use the machine's cores.
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    const draco = new DRACOLoader().setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/").setWorkerLimit(Math.max(2, Math.min(8, cores - 1)));
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: this.key, autoRefreshToken: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    // Keep what's been seen: freeing a building the moment it leaves the screen meant flying back
    // reloaded it. On a laptop or desktop the city stays in memory for the whole trip (up to ~1.2 GB).
    const keep = roomy();
    tiles.registerPlugin(new UnloadTilesPlugin(keep ? { delay: 120_000, bytesTarget: 1.2 * GB } : {}));
    if (keep) {
      tiles.lruCache.minSize = 20000;
      tiles.lruCache.maxSize = 26000;
      tiles.lruCache.minBytesSize = 1.2 * GB;
      tiles.lruCache.maxBytesSize = 1.6 * GB;
    }
    // No fade-in: the fade only advances while MapLibre repaints, so when the map goes idle tiles froze
    // half-transparent and the skyline read as flat, see-through glass. Tiles now appear solid.
    // A finer error target so towers load as real buildings, not a blurred, flattened skin.
    tiles.errorTarget = 8;
    tiles.parseQueue.maxJobs = Math.max(5, Math.min(12, cores));
    tiles.downloadQueue.maxJobs = 40;
    const redraw = () => this.map.triggerRepaint();
    // The root tileset failing means the key isn't usable (billing not active, API off, wrong site):
    // hand back to the satellite map rather than leave an empty city.
    tiles.addEventListener("load-error", (e: { tile: unknown }) => {
      if (!e.tile) this.onFail?.();
    });
    tiles.addEventListener("load-model", redraw);
    tiles.addEventListener("tiles-load-end", () => {
      redraw();
      const credits = tiles.getAttributions().filter((a) => a.type === "string").map((a) => String(a.value)).join("; ");
      this.onCredit(credits ? `Google · ${credits}` : "Google");
    });
    this.tiles = tiles;
    this.holder.add(tiles.group);
    // Diagnostics on the live site, only with ?debug3d in the address.
    if (typeof location !== "undefined" && location.search.includes("debug3d")) (globalThis as { __photo?: unknown }).__photo = this;
  }

  /**
   * Load the whole trip before it's flown: virtual cameras at each viewpoint, set up exactly like Fly
   * the trip's camera, a few at a time, until every one has its full-detail buildings in memory.
   */
  preload(views: PreloadView[], onProgress?: (fraction: number) => void) {
    this.cancelPreload();
    this.queue = views.slice();
    this.total = views.length;
    this.loadedViews = 0;
    this.onPreload = onProgress;
    onProgress?.(views.length ? 0 : 1);
    if (views.length) this.pump();
  }

  cancelPreload() {
    this.queue = [];
    this.endBatch();
    if (this.pumping) cancelAnimationFrame(this.pumping);
    this.pumping = 0;
  }

  // The map only draws when something changes; keep it drawing while the trip loads.
  private pump = () => {
    if (!this.queue.length && !this.batch.length) {
      this.pumping = 0;
      return;
    }
    this.map?.triggerRepaint();
    this.pumping = requestAnimationFrame(this.pump);
  };

  private endBatch() {
    for (const b of this.batch) this.tiles?.deleteCamera(b.cam);
    this.batch = [];
  }

  private stepPreload(c: { lat: number; lng: number }, w: number, h: number) {
    // The batch is done once nothing has been loading for a few frames (or it has had 25 seconds).
    if (this.batch.length) {
      const st = (this.tiles as unknown as { stats: { queued: number; downloading: number; parsing: number } }).stats;
      const busy = st.queued + st.downloading + st.parsing;
      this.quiet = performance.now() - this.batchAt > 800 && busy === 0 ? this.quiet + 1 : 0;
      if (this.quiet >= 4 || performance.now() - this.batchAt > 25_000) {
        this.loadedViews += this.batch.length;
        this.endBatch();
        this.onPreload?.(Math.min(1, this.loadedViews / Math.max(1, this.total)));
      }
    }
    if (!this.batch.length && this.queue.length) {
      // Only what the flight shows up close: a virtual camera that saw to the horizon asked for ~2,000
      // tiles each. The real camera loads the horizon itself, at low detail.
      this.batch = this.queue.splice(0, PRELOAD_BATCH).map((v) => ({ v, cam: new THREE.PerspectiveCamera(this.lod.fov, w / Math.max(1, h), 10, PRELOAD_FAR_M) }));
      for (const b of this.batch) this.tiles.setCamera(b.cam);
      this.batchAt = performance.now();
      this.quiet = 0;
    }
    if (!this.batch.length) return;
    // Place each virtual camera as Fly the trip would: behind the point, tilted, facing along the route.
    const k = 111319.49 * Math.cos(rad(c.lat));
    const pxPerMetre = (512 * 2 ** FLY_ZOOM) / (40075016.7 * Math.cos(rad(c.lat)));
    const cssH = this.map.getCanvas().clientHeight || 800;
    const dist = cssH / 2 / Math.tan(rad(this.lod.fov / 2)) / pxPerMetre;
    const p = rad(FLY_PITCH);
    for (const { cam, v } of this.batch) {
      const tx = (v.lon - c.lng) * k;
      const tz = -(mercY(v.lat) - mercY(c.lat)) * k;
      const b = rad(v.bearing);
      const back = Math.sin(p) * dist;
      cam.position.set(tx - Math.sin(b) * back, Math.cos(p) * dist, tz + Math.cos(b) * back);
      cam.up.set(0, 1, 0);
      cam.lookAt(tx, 0, tz);
      cam.fov = this.lod.fov;
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      this.tiles.setResolution(cam, w, h);
    }
  }

  onRemove() {
    this.cancelPreload();
    this.tiles?.dispose();
    this.renderer?.dispose();
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: { defaultProjectionData: { mainMatrix: ArrayLike<number> } }) {
    if (!this.enabled || !this.tiles) return;
    const map = this.map;
    const c = map.getCenter();
    // Place the globe of tiles in our local frame, anchored under the camera's centre.
    WGS84_ELLIPSOID.getEastNorthUpFrame(rad(c.lat), rad(c.lng), 0, this.enu);
    this.holder.matrix.copy(ENU_TO_LOCAL).multiply(this.enu.invert());
    this.holder.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, -this.groundOffset, 0));
    this.holder.matrixWorldNeedsUpdate = true;

    // A real perspective camera for choosing tile detail: where MapLibre's camera is, looking at the centre.
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const ll = (map.transform as unknown as { getCameraLngLat?: () => { lng: number; lat: number } }).getCameraLngLat?.();
    const alt = cameraAltitude(map);
    if (ll && alt != null) {
      const k = 111319.49 * Math.cos(rad(c.lat));
      this.lod.position.set((ll.lng - c.lng) * k, alt, -(mercY(ll.lat) - mercY(c.lat)) * k);
      const pitch = map.getPitch();
      const b = rad(map.getBearing());
      this.lod.up.set(0, 1, 0);
      if (pitch < 5) this.lod.up.set(Math.sin(b), 0, -Math.cos(b));
      this.lod.lookAt(0, 0, 0);
    }
    this.lod.fov = (map.transform as unknown as { fov?: number }).fov ?? 36.87;
    this.lod.aspect = w / Math.max(1, h);
    this.lod.updateProjectionMatrix();
    this.lod.updateMatrixWorld();
    this.tiles.setCamera(this.lod);
    this.tiles.setResolution(this.lod, w, h);
    if (this.queue.length || this.batch.length) this.stepPreload(c, w, h);
    this.scene.updateMatrixWorld();
    this.tiles.update();

    // Every so often, find the real ground around the centre so pins and routes sit on it. One ray
    // straight down lands on a rooftop over a skyline, which sank the whole city by that tower's
    // height; the lowest point of a few rays over the area is the street.
    const now = performance.now();
    if (now - this.lastProbe > 1200) {
      this.lastProbe = now;
      let low = Infinity;
      for (const dx of PROBE) {
        for (const dz of PROBE) {
          this.ray.set(new THREE.Vector3(dx, 9000, dz), DOWN);
          const hits = this.ray.intersectObject(this.tiles.group, true);
          if (hits.length) low = Math.min(low, hits[hits.length - 1].point.y);
        }
      }
      // Distant, low-detail tiles are coarse slabs that sit kilometres under the real surface; only
      // accept a ground height that exists on Earth (Dead Sea to Everest, plus margin).
      const next = this.groundOffset + low;
      if (low < Infinity && next > -600 && next < 9000) this.groundOffset = next;
    }

    const model = map.transform.getMatrixForModel([c.lng, c.lat], 0);
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as number[]).multiply(new THREE.Matrix4().fromArray(model as unknown as number[]));
    this.renderer.resetState();
    // The satellite drawn underneath is flat at height zero; never let it hide real ground or
    // building bases that sit a little below it.
    this.renderer.clearDepth();
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.render(this.scene, this.camera);
  }
}

type CamTransform = {
  getCameraAltitude?: () => number;
  _mercatorTransform?: { getCameraAltitude?: () => number };
  cameraToCenterDistance?: number;
  worldSize?: number;
};

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The camera's height in metres. On the globe view MapLibre leaves it empty, which left the tiles
 * with no camera, so they never loaded past the root; fall back to the flat-map answer, then work it out. */
function cameraAltitude(map: MlMap): number | null {
  const tr = map.transform as unknown as CamTransform;
  const direct = finite(tr.getCameraAltitude?.()) ?? finite(tr._mercatorTransform?.getCameraAltitude?.());
  if (direct != null) return direct;
  const dist = finite(tr.cameraToCenterDistance);
  const world = finite(tr.worldSize);
  if (dist == null || world == null) return null;
  const pxPerMetre = world / (2 * Math.PI * 6371008.8 * Math.cos(rad(map.getCenter().lat)));
  return (Math.cos(rad(map.getPitch())) * dist) / pxPerMetre;
}
