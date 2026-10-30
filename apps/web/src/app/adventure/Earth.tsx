"use client";
// The real Earth under the trip. MapLibre draws the planet from space down to the street: satellite
// imagery, terrain and 3D buildings. A Three.js layer shares its camera and depth buffer, so the
// game sits in the real city: light beacons over every place the agent picked, Qloo's taste rising
// out of the streets as glowing columns, and a traveller who flies each day's route.
import maplibregl, { type CustomLayerInterface, type GeoJSONSource, type Map as MlMap, type Marker, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as THREE from "three";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { GAME_LAYERS, LAND, REAL_LAYERS, dusk, lightFor, skyFor, type Sky } from "./world";
import { Environment } from "./env";
import { KIND_COLOR, pathIndex, pointAt, type AdventureModel, type DayRoute, type QuestNode } from "./model";

export type Spot = { name: string; lat: number; lon: number };

export type EarthProps = {
  model: AdventureModel | null;
  /** Where the trip is going, known before the places are (to fly there early). */
  destination: Spot | null;
  origin: Spot | null;
  activeDay: number | "all";
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  play: boolean;
  progress: MutableRefObject<{ day: number; t: number }>;
  onArrive: (nodeId: string, day: number) => void;
  onDayDone: (day: number) => void;
  onTick: (day: number, t: number) => void;
  scanning: boolean;
  reduced: boolean;
  introKey: number;
  homeKey: number;
  showTaste: boolean;
  /** Real satellite imagery, or the painted game map. */
  look: "photoreal" | "real" | "painted";
  /** The sky to paint: the day's forecast and the hour on the clock. */
  weather: { kind: Sky; hour: number };
  /** The journey in, as a label on the flight arc: "Lagos → Dubai · from 450 USD · 7 h". */
  journey?: string | null;
  /** Room the HUD takes on each side, so the camera frames the trip inside it. */
  pad: { top: number; right: number; bottom: number; left: number };
  onUserMove: () => void;
  onReady: () => void;
  /** Google's photoreal tiles were refused (key not active yet): the look falls back to satellite. */
  onPhotoFail?: () => void;
};

// Keyless defaults. Imagery and vector tiles can be swapped for a keyed provider with these env vars.
const SAT = process.env.NEXT_PUBLIC_SATELLITE_TILES || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_CREDIT = process.env.NEXT_PUBLIC_SATELLITE_ATTRIBUTION || "Imagery © Esri, Maxar, Earthstar Geographics";
const VECTOR = process.env.NEXT_PUBLIC_VECTOR_TILES || "https://tiles.openfreemap.org/planet";
const GLYPHS = process.env.NEXT_PUBLIC_MAP_GLYPHS || "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
/** Google Map Tiles API key: turns on Photoreal (Google Earth's 3D city models). */
export const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";
const DEM = process.env.NEXT_PUBLIC_TERRAIN_TILES ?? "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const GOLD = "#f2cf7a";

// Open connections to the tile hosts before the first tile is asked for.
if (typeof document !== "undefined") {
  for (const href of [SAT, VECTOR, GLYPHS, DEM].map((u) => { try { return new URL(u.replace(/\{[^}]+\}/g, "0")).origin; } catch { return null; } }).filter(Boolean) as string[]) {
    if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const l = document.createElement("link");
    l.rel = "preconnect";
    l.href = href;
    l.crossOrigin = "anonymous";
    document.head.appendChild(l);
  }
}

function style(): StyleSpecification {
  const terrain = Boolean(DEM);
  return {
    version: 8,
    glyphs: GLYPHS,
    projection: { type: "globe" },
    sky: {
      "sky-color": "#06122b",
      "horizon-color": "#8fb4ff",
      "fog-color": "#b9cdf0",
      "fog-ground-blend": 0.75,
      "horizon-fog-blend": 0.55,
      "sky-horizon-blend": 0.6,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 1, 10, 0.2, 12, 0],
    },
    sources: {
      sat: { type: "raster", tiles: [SAT], tileSize: 256, maxzoom: 19, attribution: SAT_CREDIT },
      ...(terrain
        ? {
            dem: { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium" },
            relief: { type: "raster-dem", tiles: [DEM], tileSize: 256, maxzoom: 14, encoding: "terrarium" },
          }
        : {}),
    },
    ...(terrain ? { terrain: { source: "dem", exaggeration: 1.15 } } : {}),
    layers: [
      { id: "space", type: "background", paint: { "background-color": "#0b1a2e" } },
      // Graded like a game: richer greens and blues, a touch more contrast.
      { id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": 0.12, "raster-contrast": 0.14, "raster-brightness-min": 0.03, "raster-brightness-max": 1, "raster-fade-duration": 0 } },
      ...(terrain
        ? [{ id: "relief", type: "hillshade" as const, source: "relief", paint: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "rgba(20, 38, 20, 0.55)", "hillshade-highlight-color": "rgba(255, 250, 225, 0.25)", "hillshade-accent-color": "rgba(30, 50, 30, 0.2)" } }]
        : []),
    ],
  };
}

// ---------- geometry helpers ----------

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Points along the great circle from a to b, [lon, lat]. Pure. */
export function greatCircle(a: Spot, b: Spot, n = 128): [number, number][] {
  const [φ1, λ1, φ2, λ2] = [rad(a.lat), rad(a.lon), rad(b.lat), rad(b.lon)];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d < 1e-6) return [[a.lon, a.lat], [b.lon, b.lat]];
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  // Keep longitudes continuous across the antimeridian.
  for (let i = 1; i < out.length; i++) {
    while (out[i][0] - out[i - 1][0] > 180) out[i][0] -= 360;
    while (out[i][0] - out[i - 1][0] < -180) out[i][0] += 360;
  }
  return out;
}

export const kmBetween = (a: Spot, b: Spot) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * (R / 1000) * Math.asin(Math.min(1, Math.sqrt(h)));
};

function circle(lat: number, lon: number, km: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    out.push([lon + (km / (111.32 * Math.cos(rad(lat)))) * Math.cos(a), lat + (km / 110.574) * Math.sin(a)]);
  }
  return out;
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const line = (coords: [number, number][], props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords.length > 1 ? coords : [...coords, ...coords] } });

const angleDiff = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

// ---------- the Three.js layer ----------

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.18, "rgba(255,255,255,0.75)");
  r.addColorStop(0.45, "rgba(255,255,255,0.18)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A beam of light: bright at the base, fading upward, with a slow shimmer.
const beamMaterial = (color: THREE.Color) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: color }, uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: "varying float vH; void main(){ vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader:
      "uniform vec3 uColor; uniform float uTime; uniform float uPower; varying float vH; void main(){ float a = pow(1.0 - vH, 2.2) * (0.75 + 0.25 * sin(uTime * 2.0 + vH * 9.0)); gl_FragColor = vec4(uColor * (1.0 + 0.6 * (1.0 - vH)), a * 0.85 * uPower); }",
  });

// Qloo's taste as hexagonal columns: instanced, coloured per instance, fading toward the top.
const tasteMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: `
      varying float vH; varying vec3 vC; varying float vW;
      void main(){
        vH = uv.y;
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #else
          vC = vec3(1.0);
        #endif
        vW = vC.g;
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uFade; varying float vH; varying vec3 vC; varying float vW;
      void main(){
        vec3 base = vec3(1.0, 0.31, 0.64);
        vec3 top = vec3(1.0, 0.82, 0.48);
        vec3 col = mix(base, top, vH * vC.r);
        // A slim pillar of light: bright at the foot, fading up, with a crisp glowing cap.
        float body = (1.0 - vH) * smoothstep(0.0, 0.04, vH);
        float cap = smoothstep(0.93, 1.0, vH) * 1.6;
        float pulse = 0.88 + 0.12 * sin(uTime * 1.3 + vC.b * 40.0);
        float a = (0.05 + 0.28 * vC.r) * body * pulse + cap * (0.25 + 0.5 * vC.r);
        gl_FragColor = vec4(col, a * uFade);
      }`,
  });

type Beacon = { id: string; group: THREE.Group; beam: THREE.Mesh; ring: THREE.Mesh; halo: THREE.Sprite; lat: number; lon: number; height: number; color: THREE.Color };

class Scene3D implements CustomLayerInterface {
  id = "backline-3d";
  type = "custom" as const;
  renderingMode = "3d" as const;
  map!: MlMap;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.Camera();
  center: Spot = { name: "", lat: 0, lon: 0 };
  base = 0;
  beacons = new Map<string, Beacon>();
  taste: THREE.InstancedMesh | null = null;
  tasteSpots: { lat: number; lon: number; h: number; r: number }[] = [];
  traveller = new THREE.Group();
  trail: THREE.Line;
  trailPts: { lat: number; lon: number }[] = [];
  /** Ground height per place, metres, refreshed when terrain tiles arrive. */
  elev = new Map<string, number>();
  selRing: THREE.Mesh;
  glow = glowTexture();
  clock = new THREE.Clock();
  env = new Environment();
  lastT = 0;
  selectedId: string | null = null;
  hoverId: string | null = null;
  tasteOn = true;
  travelling = false;

  constructor() {
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    core.scale.set(70, 70, 1);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color("#9cc8ff"), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(220, 220, 1);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 4, 240, 12, 1, true).translate(0, 120, 0), beamMaterial(new THREE.Color("#cfe2ff")));
    this.traveller.add(core, halo, beam);
    this.traveller.visible = false;
    this.scene.add(this.traveller);
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(46, 2.2, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(GOLD), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.selRing.rotation.x = Math.PI / 2;
    this.selRing.visible = false;
    this.scene.add(this.selRing);
    this.scene.add(this.env.group);
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(1);
  }

  /** Redraw at full rate only when something moves (flying, rain); otherwise a gentle 15 fps for the shimmer. */
  private pending = 0;
  tick() {
    if (this.travelling || this.env.rain.visible || this.env.snow.visible) {
      this.map.triggerRepaint();
      return;
    }
    if (this.pending) return;
    this.pending = window.setTimeout(() => {
      this.pending = 0;
      this.map?.triggerRepaint();
    }, 66);
  }

  onRemove() {
    window.clearTimeout(this.pending);
    this.renderer?.dispose();
  }

  /** Metres east (x), up (y) and south (z) of the scene's centre. */
  /** Mercator-exact offset from the scene's anchor, in metres at the anchor (what getMatrixForModel expects). */
  local(lat: number, lon: number, up = 0, ground?: number): THREE.Vector3 {
    const k = 111319.49 * Math.cos(rad(this.center.lat));
    const my = (l: number) => deg(Math.log(Math.tan(Math.PI / 4 + rad(l) / 2)));
    const x = (lon - this.center.lon) * k;
    const z = -(my(lat) - my(this.center.lat)) * k;
    return new THREE.Vector3(x, (ground ?? this.groundAt(lat, lon)) - this.base + up, z);
  }

  groundAt(lat: number, lon: number): number {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    let e = this.elev.get(key);
    if (e == null) {
      e = this.ground(lat, lon);
      this.elev.set(key, e);
    }
    return e;
  }

  ground(lat: number, lon: number): number {
    try {
      return this.map?.queryTerrainElevation?.([lon, lat]) ?? 0;
    } catch {
      return 0;
    }
  }

  setModel(model: AdventureModel | null) {
    for (const b of this.beacons.values()) {
      this.scene.remove(b.group);
      // Each beacon owns its geometry and materials (the glow texture is shared and kept), so free them.
      b.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
    }
    this.beacons.clear();
    if (this.taste) {
      this.scene.remove(this.taste);
      this.taste.dispose();
      this.taste = null;
    }
    if (!model) return;
    this.center = { name: model.city, lat: model.center.lat, lon: model.center.lon };
    for (const n of model.nodes) {
      if (!n.picked) continue;
      const color = new THREE.Color(KIND_COLOR[n.kind]);
      const height = 160 + (n.match ?? 0.35) * 420;
      const group = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(7, 16, height, 20, 1, true).translate(0, height / 2, 0), beamMaterial(color));
      const ring = new THREE.Mesh(new THREE.RingGeometry(20, 26, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 3;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(90, 90, 1);
      halo.position.y = 14;
      group.add(beam, ring, halo);
      this.scene.add(group);
      this.beacons.set(n.id, { id: n.id, group, beam, ring, halo, lat: n.lat, lon: n.lon, height, color });
    }
    // Qloo's taste heat as columns. The cell size comes from how far apart the heat points sit.
    const pts = model.heat.filter((h) => h.w > 0.05);
    if (pts.length) {
      const m = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.hypot((a.lon - b.lon) * 111320 * Math.cos(rad(a.lat)), (a.lat - b.lat) * 110574);
      const nn = pts.slice(0, 60).map((p) => Math.min(...pts.filter((q) => q !== p).map((q) => m(p, q)), 2000)).sort((a, b) => a - b);
      const cell = Math.max(70, Math.min(420, (nn[Math.floor(nn.length / 2)] ?? 300) * 0.5));
      // Slim pillars, not slabs: a fraction of the cell wide, so the city still reads underneath.
      const r = Math.max(12, Math.min(48, cell * 0.16));
      this.tasteSpots = pts.slice(0, 90).map((p) => ({ lat: p.lat, lon: p.lon, h: 30 + Math.pow(p.w, 1.5) * 360, r }));
      const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
      const shown = pts.slice(0, 90);
      const mesh = new THREE.InstancedMesh(geo, tasteMaterial(), shown.length);
      shown.forEach((p, i) => mesh.setColorAt(i, new THREE.Color(p.w, p.w, (i * 0.137) % 1)));
      mesh.frustumCulled = false;
      this.taste = mesh;
      this.scene.add(mesh);
    }
    this.placeAll();
  }

  /** Re-seats everything on the ground (terrain heights arrive after the tiles do). */
  placeAll(refresh = false) {
    if (!this.map) return;
    if (refresh) this.elev.clear();
    this.base = this.ground(this.center.lat, this.center.lon);
    for (const b of this.beacons.values()) b.group.position.copy(this.local(b.lat, b.lon));
    if (this.taste) {
      const mtx = new THREE.Matrix4();
      this.tasteSpots.forEach((s, i) => {
        const p = this.local(s.lat, s.lon);
        mtx.compose(p, new THREE.Quaternion(), new THREE.Vector3(s.r, s.h, s.r));
        this.taste!.setMatrixAt(i, mtx);
      });
      this.taste.instanceMatrix.needsUpdate = true;
    }
    this.trail.geometry.setFromPoints(this.trailPts.map((t) => this.local(t.lat, t.lon, 30)));
    this.env.place((lat, lon, up) => this.local(lat, lon, up));
    if (this.travellerAt) this.traveller.position.copy(this.local(this.travellerAt.lat, this.travellerAt.lon, 30));
  }

  travellerAt: { lat: number; lon: number } | null = null;

  /** Keep the scene's origin under the camera so small float and projection errors never show. */
  reanchor() {
    const c = this.map.getCenter();
    const dx = (c.lng - this.center.lon) * 111320 * Math.cos(rad(c.lat));
    const dy = (c.lat - this.center.lat) * 110574;
    if (Math.hypot(dx, dy) < 25) return;
    this.center = { name: this.center.name, lat: c.lat, lon: c.lng };
    this.placeAll();
  }

  moveTraveller(lat: number, lon: number) {
    this.travellerAt = { lat, lon };
    this.traveller.position.copy(this.local(lat, lon, 30, this.ground(lat, lon)));
    this.trailPts.push({ lat, lon });
    if (this.trailPts.length > 240) this.trailPts.shift();
    this.trail.geometry.setFromPoints(this.trailPts.map((t) => this.local(t.lat, t.lon, 30)));
  }

  clearTrail() {
    this.trailPts = [];
    this.travellerAt = null;
    this.trail.geometry.setFromPoints([]);
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: { defaultProjectionData: { mainMatrix: ArrayLike<number> } }) {
    const t = this.clock.getElapsedTime();
    const zoom0 = this.map.getZoom();
    // From space the city is a dot: the 3D layer only appears once you're over it.
    this.scene.visible = zoom0 > 8.2;
    if (!this.scene.visible) return;
    this.reanchor();
    this.env.tick(Math.min(0.05, t - this.lastT), zoom0, new THREE.Vector3(0, 0, 0));
    this.lastT = t;
    const zoom = this.map.getZoom();
    // Beacons read at city scale, then slim down as you come in to street level.
    const s = Math.max(0.35, Math.min(1.6, Math.pow(2, (14 - zoom) * 0.45)));
    for (const b of this.beacons.values()) {
      const sel = b.id === this.selectedId;
      const hov = b.id === this.hoverId;
      b.group.scale.set(s * (sel ? 1.5 : hov ? 1.25 : 1), s * (sel ? 1.25 : 1), s * (sel ? 1.5 : hov ? 1.25 : 1));
      (b.beam.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      (b.beam.material as THREE.ShaderMaterial).uniforms.uPower.value = this.selectedId && !sel ? 0.45 : 1;
      const pulse = 1 + 0.18 * Math.sin(t * 2.4 + b.lat * 1000);
      b.ring.scale.set(pulse, pulse, pulse);
    }
    if (this.selectedId && this.beacons.has(this.selectedId)) {
      const b = this.beacons.get(this.selectedId)!;
      this.selRing.visible = true;
      this.selRing.position.copy(b.group.position).setY(b.group.position.y + 6);
      this.selRing.scale.setScalar(s * (1.6 + 0.08 * Math.sin(t * 3)));
      this.selRing.rotation.z = t * 0.6;
    } else this.selRing.visible = false;
    if (this.taste) {
      const mat = this.taste.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = t;
      // Strong at city scale, a whisper at street level and while a place is open.
      const want = !this.tasteOn ? 0 : this.travelling ? 0.2 : zoom < 9 ? 0 : zoom < 10.5 ? (zoom - 9) / 1.5 : zoom > 14 ? Math.max(0.12, 1 - (zoom - 14) / 1.5) : 1;
      mat.uniforms.uFade.value += (want - mat.uniforms.uFade.value) * 0.08;
    }
    this.traveller.visible = this.travelling;
    this.trail.visible = this.travelling;

    const model = this.map.transform.getMatrixForModel([this.center.lon, this.center.lat], this.base);
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as number[]).multiply(new THREE.Matrix4().fromArray(model as unknown as number[]));
    this.renderer.resetState();
    this.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.renderer.render(this.scene, this.camera);
    this.tick();
  }
}

// ---------- the component ----------

export default function Earth(props: EarthProps) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const layerRef = useRef<Scene3D | null>(null);
  const photoRef = useRef<{ enabled: boolean } | null>(null);
  const journeyRef = useRef<Marker | null>(null);
  // The plane that flies the arc on the way in.
  const planeRef = useRef<Marker | null>(null);
  // The globe waited once for home to be known; after that, an unknown home just lands.
  const waitedRef = useRef(false);
  const [credit, setCredit] = useState("");
  const markers = useRef(new Map<string, { m: Marker; el: HTMLElement }>());
  const live = useRef(props);
  live.current = props;
  const state = useRef({ loaded: false, introAt: -1, introDone: false, introFor: "", introDest: null as { lat: number; lon: number } | null, flown: false, waiting: 0, originFor: "", user: false, orbit: false, touchedAt: 0, bearing: 0, raf: 0, last: 0, dwell: 0, nextStop: 0, playDay: -2, trailAt: 0 });

  // Space views are framed for a laptop; on a phone the whole globe sits inside the screen with
  // its atmosphere showing, instead of a cropped ball filling the width.
  const gz = (z: number) => {
    const el = box.current;
    if (!el) return z;
    const size = Math.min(el.clientWidth, el.clientHeight * 0.9);
    return z + Math.min(0, Math.log2(Math.max(240, size) / 700) * 0.85);
  };

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({
      container: box.current,
      style: style(),
      center: [props.destination?.lon ?? 10, (props.destination?.lat ?? 20) * 0.6],
      zoom: gz(1.35),
      pitch: 0,
      maxPitch: 78,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
      fadeDuration: 0,
      // Keep loading imagery while the camera flies, and keep plenty of it, so the city is there on arrival.
      cancelPendingTileRequestsWhileZooming: false,
      maxTileCacheSize: 600,
      // Retina at full resolution doubles the work for little visible gain on a moving 3D scene.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    });
    mapRef.current = map;
    const layer = new Scene3D();
    layerRef.current = layer;
    const s = state.current;
    const userMoved = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return;
      s.user = true;
      s.touchedAt = performance.now();
      s.orbit = false;
      live.current.onUserMove();
    };
    map.on("dragstart", userMoved);
    map.on("rotatestart", userMoved);
    map.on("pitchstart", userMoved);
    map.on("zoomstart", userMoved);
    map.on("click", (e) => {
      if ((e.originalEvent.target as HTMLElement)?.closest?.(".eq-pin")) return;
      live.current.onSelect(null);
    });
    map.on("load", () => {
      s.loaded = true;
      map.addSource("arc", { type: "geojson", data: fc([]), lineMetrics: true });
      map.addSource("heat", { type: "geojson", data: fc([]) });
      map.addSource("zone", { type: "geojson", data: fc([]) });
      map.addSource("routes", { type: "geojson", data: fc([]) });
      map.addSource("trail", { type: "geojson", data: fc([]), lineMetrics: true });
      map.addLayer({
        id: "heat",
        type: "heatmap",
        source: "heat",
        maxzoom: 17,
        paint: {
          "heatmap-weight": ["get", "w"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 15, 1.4],
          "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 9, 14, 13, 50, 16, 160],
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(255,79,163,0)", 0.25, "rgba(255,79,163,0.18)", 0.55, "rgba(255,79,163,0.42)", 0.85, "rgba(255,170,120,0.55)", 1, "rgba(255,214,140,0.7)"],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8.5, 0, 10, 0.5, 13, 0.22, 14.5, 0],
        },
      });
      map.addLayer({ id: "zone", type: "line", source: "zone", paint: { "line-color": GOLD, "line-width": 1.4, "line-dasharray": [2, 3], "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 11, 0.8] } });
      map.addLayer({ id: "route-glow", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 18], "line-blur": 8, "line-opacity": 0.35 } });
      map.addLayer({ id: "route", type: "line", source: "routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 16, 4.5], "line-opacity": 0.9 } });
      map.addLayer({ id: "trail", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 17, 8], "line-blur": 1, "line-opacity": 0.95 } });
      map.addLayer({ id: "arc-glow", type: "line", source: "arc", layout: { "line-cap": "round" }, paint: { "line-color": "#bcd6ff", "line-width": 9, "line-blur": 7, "line-opacity": 0.45 } });
      map.addLayer({
        id: "arc",
        type: "line",
        source: "arc",
        layout: { "line-cap": "round" },
        paint: { "line-width": 2.4, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "rgba(255,255,255,0.25)", 1, "#ffffff"] },
      });
      map.addLayer(layer);
      try {
        map.addSource("omt", { type: "vector", url: VECTOR, attribution: "© OpenStreetMap contributors · OpenFreeMap" });
        for (const l of [...GAME_LAYERS, ...REAL_LAYERS]) map.addLayer(l, "heat");
      } catch {
        /* the satellite globe is enough on its own */
      }
      // Google Earth's photorealistic city, loaded only when a key is set.
      if (GOOGLE_KEY) {
        import("./photoreal")
          .then(({ PhotorealLayer }) => {
            if (!mapRef.current) return;
            const pr = new PhotorealLayer(GOOGLE_KEY, (t) => setCredit(t), () => {
              if (photoRef.current !== pr) return;
              photoRef.current = null;
              try {
                if (map.getLayer(pr.id)) map.removeLayer(pr.id);
              } catch {
                /* already gone with the map */
              }
              applyLook();
              live.current.onPhotoFail?.();
            });
            photoRef.current = pr;
            map.addLayer(pr, "heat");
            applyLook();
          })
          .catch((err) => console.warn("Photoreal tiles unavailable", err));
      }
      // Map credits start folded away; the ⓘ opens them.
      const credits = box.current?.querySelector(".maplibregl-ctrl-attrib");
      credits?.classList.remove("maplibregl-compact-show");
      credits?.removeAttribute("open");
      sync();
      if (live.current.destination || live.current.model) intro();
      live.current.onReady();
    });
    // Pins only make sense once you're over the city: from space they'd pile onto one point.
    const zoomClass = () => {
      const z = map.getZoom();
      box.current?.setAttribute("data-z", z < 8.5 ? "far" : z < 12.5 ? "city" : "street");
    };
    map.on("zoom", zoomClass);
    zoomClass();
    // Labels never pile up: the best taste matches keep their names; the rest fall back to a dot
    // until you zoom in, hover or select them.
    let lastDeclutter = 0;
    map.on("render", () => {
      const now = performance.now();
      if (now - lastDeclutter < 140) return;
      lastDeclutter = now;
      declutter();
    });
    // Terrain heights arrive with the tiles: re-seat the 3D layer when the map settles.
    let idleTimer = 0;
    map.on("idle", () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        layer.env.grow(map);
        layer.placeAll(true);
      }, 60);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(s.raf);
      map.remove();
      mapRef.current = null;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data: markers, routes, heat and the 3D layer follow the model.
  const sync = () => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const p = live.current;
    if (!map || !layer || !state.current.loaded) return;
    const model = p.model;
    layer.setModel(model);
    (map.getSource("heat") as GeoJSONSource)?.setData(fc((model?.heat ?? []).map((h) => ({ type: "Feature", properties: { w: h.w }, geometry: { type: "Point", coordinates: [h.lon, h.lat] } }))));
    (map.getSource("zone") as GeoJSONSource)?.setData(fc(model?.zone ? [line(circle(model.zone.lat, model.zone.lon, Math.max(0.4, model.zone.km)))] : []));
    (map.getSource("routes") as GeoJSONSource)?.setData(fc((model?.routes ?? []).filter((r) => r.geo.length >= 2).map((r) => line(r.geo, { day: r.day, color: r.color }))));
    // Markers: one per place, styled by CSS; the picks carry their name.
    const want = new Set((model?.nodes ?? []).map((n) => n.id));
    for (const [id, m] of markers.current) if (!want.has(id)) (m.m.remove(), markers.current.delete(id));
    for (const n of model?.nodes ?? []) {
      let m = markers.current.get(n.id);
      if (!m) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "eq-pin";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          live.current.onSelect(n.id);
        });
        el.addEventListener("mouseenter", () => live.current.onHover(n.id));
        el.addEventListener("mouseleave", () => live.current.onHover(null));
        const mk = new maplibregl.Marker({ element: el, anchor: "left", offset: [-7, 0], pitchAlignment: "viewport", rotationAlignment: "viewport" }).setLngLat([n.lon, n.lat]).addTo(map);
        m = { m: mk, el };
        markers.current.set(n.id, m);
      }
      m.m.setLngLat([n.lon, n.lat]);
      pinContent(m.el, n);
    }
    styleState();
  };

  const declutter = () => {
    const map = mapRef.current;
    const p = live.current;
    if (!map || !p.model) return;
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const order = [...p.model.nodes].sort((a, b) => rankPin(b, p) - rankPin(a, p));
    for (const n of order) {
      const m = markers.current.get(n.id);
      if (!m) continue;
      const pt = map.project([n.lon, n.lat]);
      const w = 22 + n.name.length * 7.2 + (n.rank ? 22 : 0);
      const r = { x: pt.x - 8, y: pt.y - 14, w, h: 28 };
      const hit = taken.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
      const show = !hit || n.id === p.selectedId || n.id === p.hoverId;
      m.el.classList.toggle("quiet", !show);
      if (show && (n.picked || n.id === p.selectedId)) taken.push(r);
    }
  };

  const pinContent = (el: HTMLElement, n: QuestNode) => {
    // Keep MapLibre's own marker classes: they carry the positioning.
    const keep = [...el.classList].filter((c) => c.startsWith("maplibregl-") || c === "sel" || c === "hov" || c === "off" || c === "quiet");
    el.className = [...keep, "eq-pin", `k-${n.kind}`, ...(n.picked ? ["picked"] : [])].join(" ");
    el.style.setProperty("--c", KIND_COLOR[n.kind]);
    el.setAttribute("aria-label", n.name);
    el.innerHTML = `<i></i><span>${escapeHtml(n.name)}${n.rank && n.picked ? `<b>#${n.rank.n}</b>` : ""}</span>`;
  };

  // Selection, hover, the active day and the taste toggle.
  const styleState = () => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const p = live.current;
    if (!map || !layer || !state.current.loaded) return;
    layer.selectedId = p.selectedId;
    layer.hoverId = p.hoverId;
    layer.tasteOn = p.showTaste;
    for (const [id, m] of markers.current) {
      m.el.classList.toggle("sel", id === p.selectedId);
      m.el.classList.toggle("hov", id === p.hoverId);
      const onDay = typeof p.activeDay === "number" ? (p.model?.nodes.find((n) => n.id === id)?.visits.some((v) => v.day === p.activeDay) ?? false) : true;
      m.el.classList.toggle("off", !onDay);
    }
    const day = p.activeDay;
    const op = (on: number, off: number): maplibregl.ExpressionSpecification | number => (day === "all" ? on : ["case", ["==", ["get", "day"], day], on, off]);
    map.setPaintProperty("route", "line-opacity", op(0.9, 0.12));
    map.setPaintProperty("route-glow", "line-opacity", op(0.35, 0.04));
    map.setLayoutProperty("heat", "visibility", p.showTaste ? "visible" : "none");
    applyLook();
    map.setLayoutProperty("zone", "visibility", p.showTaste ? "visible" : "none");
  };

  const applyLook = () => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const p = live.current;
    if (!map || !layer || !state.current.loaded) return;
    const photo = p.look === "photoreal" && Boolean(photoRef.current);
    const real = p.look === "real" || (p.look === "photoreal" && !photo);
    for (const l of GAME_LAYERS) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, "visibility", real || photo ? "none" : "visible");
    for (const l of REAL_LAYERS) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, "visibility", real ? "visible" : "none");
    map.setLayoutProperty("sat", "visibility", real || photo ? "visible" : "none");
    if (photoRef.current) photoRef.current.enabled = photo;
    // Google's tiles carry their own terrain; MapLibre's would lift the satellite through them.
    try {
      if (photo && map.getTerrain()) map.setTerrain(null);
      if (!photo && !map.getTerrain() && DEM) map.setTerrain({ source: "dem", exaggeration: 1.15 });
      if (map.getLayer("relief")) map.setLayoutProperty("relief", "visibility", photo ? "none" : "visible");
    } catch {
      /* terrain is optional */
    }
    const lat = p.model?.center.lat ?? p.destination?.lat ?? 20;
    const { kind, hour } = p.weather;
    const night = dusk(kind, hour, lat);
    map.setPaintProperty("space", "background-color", real ? "#0b1a2e" : LAND);
    map.setPaintProperty("sat", "raster-brightness-max", 1 - night * 0.85);
    map.setPaintProperty("sat", "raster-saturation", 0.12 - night * 0.4);
    try {
      map.setSky(skyFor(kind, hour, lat));
      map.setLight(lightFor(kind, hour, lat));
    } catch {
      /* older styles without sky support */
    }
    layer.env.setWeather(kind, hour, lat);
    box.current?.style.setProperty("--night", String(real ? 0 : night));
    map.triggerRepaint();
  };

  const padding = () => {
    const p = live.current.pad;
    const w = box.current?.clientWidth ?? 1200;
    const h = box.current?.clientHeight ?? 800;
    // Never pad more than leaves a sensible window in the middle.
    const sx = Math.min(1, (w * 0.6) / Math.max(1, p.left + p.right));
    const sy = Math.min(1, (h * 0.55) / Math.max(1, p.top + p.bottom));
    return { top: p.top * sy, bottom: p.bottom * sy, left: p.left * sx, right: p.right * sx };
  };

  const overview = (duration: number) => {
    const map = mapRef.current;
    const model = live.current.model;
    if (!map || !model) return;
    const pts = model.nodes.filter((n) => n.picked);
    const use: { lat: number; lon: number }[] = pts.length >= 2 ? pts : model.nodes.length ? model.nodes : model.heat.filter((h) => h.w > 0.3);
    if (!use.length) return;
    const b = new maplibregl.LngLatBounds();
    for (const n of use) b.extend([n.lon, n.lat]);
    const cam = map.cameraForBounds(b, { padding: padding(), maxZoom: 15.2 });
    if (!cam) return;
    map.flyTo({ ...cam, zoom: Math.min(15.2, (cam.zoom ?? 13) - 0.15), pitch: 58, bearing: -16, duration: live.current.reduced ? 0 : duration, curve: 1.35, essential: true });
  };

  // The journey in: from home, across the globe, down into the city.
  const intro = () => {
    const map = mapRef.current;
    const p = live.current;
    const s = state.current;
    const dest = p.destination ?? (p.model ? { name: p.model.city, lat: p.model.center.lat, lon: p.model.center.lon } : null);
    if (!map || !s.loaded || !dest) return;
    s.introFor = `${dest.lat.toFixed(2)},${dest.lon.toFixed(2)}`;
    s.introDest = { lat: dest.lat, lon: dest.lon };
    s.introAt = performance.now();
    s.originFor = p.origin ? `${p.origin.lat.toFixed(2)},${p.origin.lon.toFixed(2)}` : "";
    s.user = false;
    const arc = map.getSource("arc") as GeoJSONSource;
    const from = p.origin && kmBetween(p.origin, dest) > 150 ? p.origin : null;
    // Where they're flying from is usually known a few seconds after the destination. Keep the globe
    // turning gently until then, so the journey is one flight, not a spin in, a jump out and a flight.
    if (s.waiting) {
      window.clearTimeout(s.waiting);
      s.waiting = 0;
    }
    if (!from && !p.reduced && !s.flown && !p.model && !waitedRef.current) {
      s.waiting = window.setTimeout(() => {
        s.waiting = 0;
        waitedRef.current = true;
        intro();
      }, 7000);
      return;
    }
    const land = () => {
      s.introDone = true;
      if (live.current.model && (live.current.model.nodes.length || live.current.model.heat.length)) overview(4200);
      else map.flyTo({ center: [dest.lon, dest.lat], zoom: 10.6, pitch: 48, bearing: -12, duration: live.current.reduced ? 0 : 4200, essential: true });
    };
    if (p.reduced) {
      arc.setData(fc(from ? [line(greatCircle(from, dest))] : []));
      land();
      return;
    }
    s.introDone = false;
    if (from) {
      s.flown = true;
      const path = greatCircle(from, dest);
      const far = kmBetween(from, dest);
      // Turn the globe to home (no cut), then fly.
      const lead = map.getZoom() < 5 ? 1300 : 0;
      if (lead) map.easeTo({ center: [from.lon, from.lat], zoom: gz(far > 4000 ? 1.6 : 2.6), pitch: 0, bearing: 0, duration: lead, easing: (x) => 1 - Math.pow(1 - x, 3) });
      else map.jumpTo({ center: [from.lon, from.lat], zoom: gz(far > 4000 ? 1.6 : 2.6), pitch: 0, bearing: 0 });
      window.setTimeout(() => takeOff(path, far), lead);
    } else {
      arc.setData(fc([]));
      map.easeTo({ center: [dest.lon, dest.lat], zoom: gz(3), pitch: 0, bearing: 0, duration: 2600 });
      window.setTimeout(land, 2700);
    }

    function takeOff(path: ReturnType<typeof greatCircle>, far: number) {
      if (!map || !dest) return;
      const t0 = performance.now();
      const dur = 4200;
      const mid = path[Math.floor(path.length / 2)];
      map.easeTo({ center: mid, zoom: gz(far > 4000 ? 1.45 : 2.4), duration: dur * 0.5, easing: (x) => x });
      window.setTimeout(() => map.easeTo({ center: [dest.lon, dest.lat], zoom: gz(far > 4000 ? 2.6 : 3.6), duration: dur * 0.5, easing: (x) => 1 - (1 - x) * (1 - x) }), dur * 0.5);
      planeRef.current?.remove();
      const pe = document.createElement("div");
      pe.className = "eq-plane-pin";
      pe.innerHTML = `<div class="eq-plane"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 1.6c.9 0 1.5 1.1 1.5 2.4v5.3l8 4.7v2.2l-8-2.4v4.8l2.6 2v1.7L12 21.2l-4.1 1.1v-1.7l2.6-2v-4.8l-8 2.4V14l8-4.7V4c0-1.3.6-2.4 1.5-2.4z" fill="currentColor"/></svg></div>`;
      const plane = new maplibregl.Marker({ element: pe, anchor: "center", rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(path[0] as [number, number]).addTo(map);
      planeRef.current = plane;
      const heading = (a: number[], b: number[]) => {
        const r = Math.PI / 180;
        const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
        const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
        return (Math.atan2(y, x) / r + 360) % 360;
      };
      const step = () => {
        const f = Math.min(1, (performance.now() - t0) / dur);
        const ease = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
        const n = Math.max(2, Math.round(ease * path.length));
        arc.setData(fc([line(path.slice(0, n))]));
        const head = path[Math.min(path.length - 1, n - 1)];
        const prev = path[Math.max(0, Math.min(path.length - 1, n - 1) - 1)];
        if (planeRef.current === plane) plane.setLngLat(head as [number, number]).setRotation(heading(prev, head));
        if (f < 1) requestAnimationFrame(step);
        else {
          pe.classList.add("is-landed");
          window.setTimeout(() => {
            if (planeRef.current === plane) planeRef.current = null;
            plane.remove();
          }, 900);
          window.setTimeout(land, 250);
        }
      };
      requestAnimationFrame(step);
    }
  };

  // Back from another tab mid-journey: the browser paused the flight, so land in the city now.
  useEffect(() => {
    const back = () => {
      const map = mapRef.current;
      const s = state.current;
      if (document.visibilityState !== "visible" || !map || !s.loaded || s.user || !s.introFor || s.waiting) return;
      if (map.getZoom() < 7 && !map.isMoving() && performance.now() - s.introAt > 9000) {
        s.introDone = true;
        const p = live.current;
        if (p.model && (p.model.nodes.length || p.model.heat.length)) overview(2600);
        else if (p.destination) map.flyTo({ center: [p.destination.lon, p.destination.lat], zoom: 10.6, pitch: 48, bearing: -12, duration: 2600, essential: true });
      }
    };
    document.addEventListener("visibilitychange", back);
    const t = window.setInterval(back, 4000);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const framedSig = useRef("");
  const modelSig = props.model ? `${props.model.nodes.map((n) => `${n.id}${n.picked ? "+" : ""}`).join(",")}|${props.model.heat.length}` : "";
  useEffect(() => {
    sync();
    const s = state.current;
    const dest = props.destination ?? (props.model ? { lat: props.model.center.lat, lon: props.model.center.lon } : null);
    const key = dest ? `${dest.lat.toFixed(2)},${dest.lon.toFixed(2)}` : "";
    const originKey = props.origin ? `${props.origin.lat.toFixed(2)},${props.origin.lon.toFixed(2)}` : "";
    // A destination refined by a few km (the quick guess, then the agent's pin) isn't a new journey.
    const moved = dest && (!s.introDest || kmBetween({ name: "", ...s.introDest }, { name: "", ...dest }) > 60);
    if (key && s.loaded && s.introFor !== key && (moved || (!s.flown && !s.introDone && !s.waiting))) intro();
    // Home became known: fly in from there, once, unless they're already exploring.
    else if (key && s.loaded && originKey && s.originFor !== originKey && !s.flown && !s.user && !props.selectedId && !props.play) intro();
    // Only re-frame when the places themselves changed, not on every re-render of the same plan.
    else if (props.model && s.introDone && !s.user && !props.selectedId && !props.play && framedSig.current !== modelSig) overview(2600);
    framedSig.current = modelSig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.model, props.destination?.lat, props.destination?.lon, props.origin?.lat]);

  // The journey label rides the middle of the flight arc.
  useEffect(() => {
    const map = mapRef.current;
    const p = props;
    const dest = p.destination ?? (p.model?.destination ?? null);
    journeyRef.current?.remove();
    journeyRef.current = null;
    if (!map || !p.origin || !dest || !p.journey || kmBetween(p.origin, dest) < 150) return;
    const path = greatCircle(p.origin, dest);
    const mid = path[Math.floor(path.length / 2)];
    const el = document.createElement("div");
    el.className = "eq-journey-pin";
    el.innerHTML = `<div class="eq-journey"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2.5 13.5 21 6l-4 13-4.5-4.5L9 18v-5l9-6-11 5.5z" fill="currentColor"/></svg><span>${escapeHtml(p.journey)}</span></div>`;
    journeyRef.current = new maplibregl.Marker({ element: el, anchor: "bottom", pitchAlignment: "viewport" }).setLngLat(mid).addTo(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.journey, props.origin?.lat, props.origin?.lon, props.destination?.lat, props.destination?.lon]);

  useEffect(() => {
    styleState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedId, props.hoverId, props.activeDay, props.showTaste, props.look, props.weather.kind, props.weather.hour]);

  useEffect(() => {
    // Replaying the way in never waits for home: what's known now is what flies.
    if (props.introKey > 0) waitedRef.current = true;
    if (state.current.loaded) intro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.introKey]);

  useEffect(() => {
    if (props.homeKey > 0) {
      state.current.user = false;
      state.current.orbit = false;
      overview(1800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.homeKey]);

  // Fly to a place, then circle it slowly, as if you were standing there.
  useEffect(() => {
    const map = mapRef.current;
    const s = state.current;
    if (!map || !props.selectedId || props.play) return;
    const n = props.model?.nodes.find((x) => x.id === props.selectedId);
    if (!n) return;
    s.user = false;
    s.orbit = false;
    const pad = padding();
    map.flyTo({ center: [n.lon, n.lat], zoom: 16.3, pitch: 66, bearing: map.getBearing() - 30, duration: props.reduced ? 0 : 2800, curve: 1.5, padding: { top: pad.top, bottom: pad.bottom, left: pad.left, right: pad.right }, essential: true });
    const start = () => {
      if (live.current.selectedId === n.id && !s.user) s.orbit = true;
    };
    map.once("moveend", start);
    return () => {
      map.off("moveend", start);
      s.orbit = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedId]);

  // One animation loop: the idle globe spin, the orbit and flying a day's route.
  useEffect(() => {
    const s = state.current;
    let alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, s.last ? (now - s.last) / 1000 : 0);
      s.last = now;
      const map = mapRef.current;
      const p = live.current;
      if (map && s.loaded) {
        if (p.play && p.model) fly(map, p, dt);
        else {
          if (layerRef.current?.travelling) {
            layerRef.current.travelling = false;
            layerRef.current.clearTrail();
            (map.getSource("trail") as GeoJSONSource)?.setData(fc([]));
          }
          s.playDay = -2;
          if (s.orbit && !p.reduced && !map.isMoving()) map.setBearing(map.getBearing() + dt * 5);
          // Left alone in the city, the camera drifts slowly around it, like a film's establishing shot.
          else if (p.model && !p.reduced && !map.isMoving() && map.getZoom() > 10.5 && now - s.touchedAt > 9000) map.setBearing(map.getBearing() + dt * 1.6);
          else if ((!p.destination || s.waiting) && !p.model && !s.user && !p.reduced && map.getZoom() < 3 && !map.isMoving()) map.setCenter([map.getCenter().lng + dt * 6, map.getCenter().lat]);
        }
      }
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(s.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flyCache = useRef<{ day: number; route: DayRoute; pts: [number, number][]; idx: { cum: number[]; total: number }; km: number } | null>(null);

  const fly = (map: MlMap, p: EarthProps, dt: number) => {
    const s = state.current;
    const layer = layerRef.current!;
    const prog = p.progress.current;
    const route = p.model!.routes.find((r) => r.day === prog.day);
    if (!route || route.geo.length < 2) {
      p.onDayDone(prog.day);
      return;
    }
    if (!flyCache.current || flyCache.current.day !== route.day || flyCache.current.route !== route) {
      const lat0 = route.geo[0][1];
      const pts = route.geo.map(([lon, lat]) => [(lon - route.geo[0][0]) * 111.32 * Math.cos(rad(lat0)), -(lat - lat0) * 110.574] as [number, number]);
      const idx = pathIndex(pts);
      flyCache.current = { day: route.day, route, pts, idx, km: idx.total };
    }
    const c = flyCache.current;
    if (s.playDay !== route.day) {
      s.playDay = route.day;
      s.dwell = 0;
      s.nextStop = route.stops.findIndex((x) => x.at >= prog.t - 1e-6);
      if (s.nextStop < 0) s.nextStop = route.stops.length;
      layer.clearTrail();
      layer.travelling = true;
      s.bearing = map.getBearing();
    }
    // About 2 seconds per km, between 16 and 46 seconds a day, plus a pause at each stop.
    const dur = Math.max(16, Math.min(46, 8 + c.km * 2.2));
    if (s.dwell > 0) s.dwell -= dt;
    else {
      prog.t = Math.min(1, prog.t + dt / dur);
      const stop = route.stops[s.nextStop];
      if (stop && prog.t >= stop.at) {
        prog.t = stop.at;
        s.dwell = 1.5;
        s.nextStop++;
        p.onArrive(stop.nodeId, route.day);
      }
    }
    const here = pointAt(c.pts, c.idx, prog.t);
    const ahead = pointAt(c.pts, c.idx, Math.min(1, prog.t + 0.03));
    const toLonLat = (x: number, z: number): [number, number] => [route.geo[0][0] + x / (111.32 * Math.cos(rad(route.geo[0][1]))), route.geo[0][1] - z / 110.574];
    const [lon, lat] = toLonLat(here.x, here.z);
    const heading = (Math.atan2(ahead.x - here.x, -(ahead.z - here.z)) * 180) / Math.PI;
    if (Math.hypot(ahead.x - here.x, ahead.z - here.z) > 0.002) s.bearing += angleDiff(s.bearing, heading) * Math.min(1, dt * 1.2);
    map.jumpTo({ center: [lon, lat], zoom: 16.1, pitch: 64, bearing: s.bearing });
    layer.moveTraveller(lat, lon);
    if (performance.now() - s.trailAt > 90) {
      s.trailAt = performance.now();
      const done: [number, number][] = [];
      for (let i = 0; i < c.pts.length && c.idx.cum[i] <= prog.t * c.idx.total; i++) done.push(route.geo[i]);
      done.push([lon, lat]);
      (map.getSource("trail") as GeoJSONSource)?.setData(fc([line(done)]));
    }
    p.onTick(route.day, prog.t);
    if (prog.t >= 1 && s.dwell <= 0) {
      s.playDay = -2;
      p.onDayDone(route.day);
    }
  };

  return (
    <>
      <div ref={box} className="eq-earth" />
      {props.look === "photoreal" && credit && <p className="eq-credit">{credit}</p>}
    </>
  );
}

function rankPin(n: QuestNode, p: EarthProps): number {
  return (n.id === p.selectedId ? 10 : 0) + (n.id === p.hoverId ? 5 : 0) + (n.picked ? 2 : 0) + (n.match ?? 0);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
