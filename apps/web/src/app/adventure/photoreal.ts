// Google's Photorealistic 3D Tiles (the data behind Google Earth) inside the MapLibre map: real
// buildings, roofs, trees and terrain, textured from aerial photography. Rendered by three.js through
// a MapLibre custom layer that shares the map's camera, so pins and routes stay on top of the real city.
// Needs NEXT_PUBLIC_GOOGLE_MAPS_KEY with the Map Tiles API enabled.
import * as THREE from "three";
import type { CustomLayerInterface, Map as MlMap } from "maplibre-gl";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin, GoogleCloudAuthPlugin, TileCompressionPlugin, TilesFadePlugin, UnloadTilesPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const mercY = (lat: number) => deg(Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2)));

// Our scene's axes: x east, y up, z south. The ellipsoid's local frame is x east, y north, z up.
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
  private enu = new THREE.Matrix4();
  private ray = new THREE.Raycaster();

  constructor(private key: string, private onCredit: (text: string) => void) {
    this.holder.matrixAutoUpdate = false;
    this.scene.add(this.holder);
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const draco = new DRACOLoader().setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: this.key, autoRefreshToken: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UnloadTilesPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.errorTarget = 16;
    const redraw = () => this.map.triggerRepaint();
    tiles.addEventListener("load-model", redraw);
    tiles.addEventListener("tiles-load-end", () => {
      redraw();
      const credits = tiles.getAttributions().filter((a) => a.type === "string").map((a) => String(a.value)).join("; ");
      this.onCredit(credits ? `Google · ${credits}` : "Google");
    });
    this.tiles = tiles;
    this.holder.add(tiles.group);
  }

  onRemove() {
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
    const tr = map.transform as unknown as { getCameraLngLat?: () => { lng: number; lat: number }; getCameraAltitude?: () => number };
    const ll = tr.getCameraLngLat?.();
    const alt = tr.getCameraAltitude?.();
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
    this.scene.updateMatrixWorld();
    this.tiles.update();

    // Every so often, find the real ground under the centre so pins and routes sit on it.
    const now = performance.now();
    if (now - this.lastProbe > 1200) {
      this.lastProbe = now;
      this.ray.set(new THREE.Vector3(0, 9000, 0), new THREE.Vector3(0, -1, 0));
      const hit = this.ray.intersectObject(this.tiles.group, true)[0];
      if (hit) this.groundOffset += hit.point.y;
    }

    const model = map.transform.getMatrixForModel([c.lng, c.lat], 0);
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as number[]).multiply(new THREE.Matrix4().fromArray(model as unknown as number[]));
    this.renderer.resetState();
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.render(this.scene, this.camera);
  }
}
