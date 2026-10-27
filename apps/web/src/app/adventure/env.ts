// The living environment inside the Three.js layer: trees grown where OpenStreetMap says there are
// parks and forests, clouds and rain or snow from the day's forecast, and sunlight from the hour.
import * as THREE from "three";
import type { Map as MlMap } from "maplibre-gl";
import { sunAt, weatherMix, type Sky } from "./world";

type Local = (lat: number, lon: number, up?: number) => THREE.Vector3;

const MAX_TREES = 2200;

// Small deterministic random, so the same park grows the same trees every time.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function inRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function cloudTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const r = rng(7);
  for (let i = 0; i < 60; i++) {
    const x = 40 + r() * 176;
    const y = 50 + r() * 40 - Math.abs(x - 128) * 0.12;
    const rad = 18 + r() * 34;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, "rgba(255,255,255,0.22)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.12)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Environment {
  group = new THREE.Group();
  hemi = new THREE.HemisphereLight(0xdcefff, 0x4f7a32, 1.1);
  sun = new THREE.DirectionalLight(0xfff3dc, 1.4);
  trees: { lat: number; lon: number; s: number; h: number; kind: number }[] = [];
  crowns: THREE.InstancedMesh;
  cones: THREE.InstancedMesh;
  trunks: THREE.InstancedMesh;
  clouds = new THREE.Group();
  rain: THREE.LineSegments;
  snow: THREE.Points;
  kind: Sky = "clear";
  hour = 13;
  lat = 0;
  lastQuery = { lat: 0, lon: 0, z: 0 };
  rainOff = 0;
  snowOff = 0;

  constructor() {
    const crown = new THREE.IcosahedronGeometry(1, 1);
    // Rough the crowns up a little so they read as foliage, not balls.
    const pos = crown.attributes.position;
    const r = rng(3);
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.85 + r() * 0.3), pos.getY(i) * (0.85 + r() * 0.3), pos.getZ(i) * (0.85 + r() * 0.3));
    crown.computeVertexNormals();
    const leaf = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
    this.crowns = new THREE.InstancedMesh(crown, leaf, MAX_TREES);
    this.cones = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), leaf, MAX_TREES);
    this.trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }), MAX_TREES);
    for (const m of [this.crowns, this.cones, this.trunks]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.sun.position.set(300, 800, 200);
    this.group.add(this.hemi, this.sun, this.sun.target);

    const tex = cloudTexture();
    const cr = rng(11);
    for (let i = 0; i < 44; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.6, fog: false }));
      const w = 900 + cr() * 1500;
      s.scale.set(w, w * 0.45, 1);
      s.userData = { x: (cr() - 0.5) * 14000, z: (cr() - 0.5) * 14000, y: 2300 + cr() * 1400, speed: 4 + cr() * 6 };
      this.clouds.add(s);
    }
    this.group.add(this.clouds);

    const drops = 3500;
    const rp = new Float32Array(drops * 6);
    const rr = rng(19);
    for (let i = 0; i < drops; i++) {
      const x = (rr() - 0.5) * 1800;
      const y = rr() * 900;
      const z = (rr() - 0.5) * 1800;
      rp.set([x, y, z, x + 2, y + 16, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    const flakes = 2500;
    const sp = new Float32Array(flakes * 3);
    for (let i = 0; i < flakes; i++) sp.set([(rr() - 0.5) * 1600, rr() * 700, (rr() - 0.5) * 1600], i * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  setWeather(kind: Sky, hour: number, lat: number) {
    this.kind = kind;
    this.hour = hour;
    this.lat = lat;
    const s = sunAt(hour, lat);
    const w = weatherMix(kind);
    const light = (0.25 + 0.75 * s.day) * (1 - w.cloud * 0.35);
    this.hemi.intensity = 0.35 + 1.0 * light;
    this.hemi.color.set(s.day < 0.1 ? 0x6f86b8 : 0xdcefff);
    this.sun.intensity = s.day < 0.05 ? 0.15 : 1.6 * light;
    this.sun.color.set(s.elevation < 12 && s.day > 0 ? 0xffc890 : 0xfff3dc);
    const az = (s.azimuth * Math.PI) / 180;
    const el = (Math.max(8, s.elevation) * Math.PI) / 180;
    this.sun.position.set(Math.sin(az) * Math.cos(el) * 1000, Math.sin(el) * 1000, -Math.cos(az) * Math.cos(el) * 1000);
    const grey = kind === "rain" || kind === "storm" ? 0.62 : kind === "cloudy" || kind === "fog" ? 0.82 : 1;
    const shade = grey * (0.35 + 0.65 * s.day);
    const n = Math.round(this.clouds.children.length * w.cloud);
    this.clouds.children.forEach((c, i) => {
      c.visible = i < n;
      const m = (c as THREE.Sprite).material as THREE.SpriteMaterial;
      m.color.setRGB(shade, shade, shade * (s.day < 0.2 ? 1.1 : 1));
      m.opacity = 0.22 + w.cloud * 0.3;
    });
    this.rain.visible = w.rain > 0;
    (this.rain.material as THREE.LineBasicMaterial).opacity = 0.25 + w.rain * 0.35;
    this.snow.visible = w.snow > 0;
  }

  /** Grows trees in the parks and woods around the view, from the vector tiles already loaded. */
  grow(map: MlMap) {
    const zoom = map.getZoom();
    const c = map.getCenter();
    const moved = Math.hypot((c.lng - this.lastQuery.lon) * 111 * Math.cos((c.lat * Math.PI) / 180), (c.lat - this.lastQuery.lat) * 111);
    if (zoom < 13.5) {
      if (this.trees.length) this.trees = [];
      return false;
    }
    if (moved < 0.4 && Math.abs(zoom - this.lastQuery.z) < 1 && this.trees.length) return false;
    this.lastQuery = { lat: c.lat, lon: c.lng, z: zoom };
    let feats: GeoJSON.Feature[] = [];
    try {
      feats = [
        ...map.querySourceFeatures("omt", { sourceLayer: "park" }),
        ...map.querySourceFeatures("omt", { sourceLayer: "landcover", filter: ["in", ["get", "class"], ["literal", ["wood", "forest", "grass", "scrub"]]] }),
      ] as GeoJSON.Feature[];
    } catch {
      return false;
    }
    const b = map.getBounds();
    const pad = 0.004;
    const [w, s, e, n] = [b.getWest() - pad, b.getSouth() - pad, b.getEast() + pad, b.getNorth() + pad];
    const out: typeof this.trees = [];
    const seen = new Set<string>();
    for (const f of feats) {
      if (out.length >= MAX_TREES) break;
      const cls = String((f.properties as Record<string, unknown>)?.class ?? "park");
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
      for (const poly of polys) {
        const ring = poly[0] as number[][];
        if (!ring || ring.length < 4) continue;
        let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
        for (const [x, y] of ring) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
        if (x1 < w || x0 > e || y1 < s || y0 > n) continue;
        const key = `${x0.toFixed(5)},${y0.toFixed(5)},${ring.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const kmx = (x1 - x0) * 111.32 * Math.cos((y0 * Math.PI) / 180);
        const kmy = (y1 - y0) * 110.57;
        const area = kmx * kmy * 1e6;
        const dense = cls === "wood" || cls === "forest";
        const per = dense ? 220 : cls === "grass" ? 2600 : 700;
        const want = Math.min(400, Math.round(area / per));
        const r = rng(Math.round((x0 + 180) * 1e5) ^ Math.round((y0 + 90) * 1e5));
        for (let i = 0, tries = 0; i < want && tries < want * 3 && out.length < MAX_TREES; tries++) {
          const lon = x0 + r() * (x1 - x0);
          const lat = y0 + r() * (y1 - y0);
          if (lon < w || lon > e || lat < s || lat > n) continue;
          if (!inRing(lon, lat, ring)) continue;
          i++;
          out.push({ lat, lon, s: 3 + r() * 3.2, h: 7 + r() * 9, kind: dense && r() < 0.35 ? 1 : 0 });
        }
      }
    }
    this.trees = out;
    return true;
  }

  place(local: Local) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let a = 0;
    let b = 0;
    this.trees.forEach((t, i) => {
      const p = local(t.lat, t.lon);
      m.compose(p, q, new THREE.Vector3(0.6 + t.s * 0.06, t.h * 0.45, 0.6 + t.s * 0.06));
      this.trunks.setMatrixAt(i, m);
      col.setHSL(0.26 + (i % 7) * 0.012, 0.42 + (i % 5) * 0.04, 0.24 + (i % 9) * 0.018);
      if (t.kind === 1) {
        m.compose(p.clone().setY(p.y + t.h * 0.25), q, new THREE.Vector3(t.s * 0.75, t.h, t.s * 0.75));
        this.cones.setMatrixAt(b, m);
        this.cones.setColorAt(b, col.offsetHSL(0.02, 0, -0.04));
        b++;
      } else {
        m.compose(p.clone().setY(p.y + t.h * 0.62), q, new THREE.Vector3(t.s, t.h * 0.42, t.s));
        this.crowns.setMatrixAt(a, m);
        this.crowns.setColorAt(a, col);
        a++;
      }
    });
    this.trunks.count = this.trees.length;
    this.crowns.count = a;
    this.cones.count = b;
    for (const im of [this.trunks, this.crowns, this.cones]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  tick(dt: number, zoom: number, base: THREE.Vector3) {
    const w = weatherMix(this.kind);
    // Clouds drift with the wind and wrap around the view.
    for (const c of this.clouds.children) {
      const u = c.userData as { x: number; z: number; y: number; speed: number };
      u.x += u.speed * dt * 6;
      if (u.x > 7000) u.x -= 14000;
      c.position.set(base.x + u.x, base.y + u.y, base.z + u.z);
    }
    // From high above, painted clouds just hide the city; they belong to the street-level sky.
    this.clouds.visible = zoom > 13.2;
    const near = zoom >= 13;
    this.rain.visible = near && w.rain > 0;
    this.snow.visible = near && w.snow > 0;
    if (this.rain.visible) {
      this.rainOff -= dt * 520;
      if (this.rainOff < -300) this.rainOff += 300;
      this.rain.position.set(base.x, base.y + this.rainOff, base.z);
    }
    if (this.snow.visible) {
      this.snowOff -= dt * 40;
      if (this.snowOff < -200) this.snowOff += 200;
      this.snow.position.set(base.x, base.y + this.snowOff, base.z);
    }
    this.trunks.visible = this.crowns.visible = this.cones.visible = zoom >= 13.5;
  }
}
