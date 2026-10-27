"use client";
// The adventure map's 3D world (react-three-fiber). A glowing terrain where Qloo's taste heat rises
// as light, quest markers for every place, a glowing route per day, a drone that flies the trip and
// a radar that sweeps while the agent is still searching. All reading from one AdventureModel.
import { memo, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { KIND_COLOR, hoursOf, pathIndex, pointAt, type AdventureModel, type DayRoute, type QuestNode } from "./model";

export type Shared = {
  /** The drone's position and heading, read by the camera when following it. */
  drone: { pos: THREE.Vector3; heading: number };
  /** Set to now+ms to make the camera fly to the selected place. */
  focusUntil: number;
  /** Set to now+ms to fly back to the overview. */
  homeUntil: number;
  /** The camera follows the drone while this is true. */
  follow: boolean;
  /** Hours (0–24) of the moment on screen, for the sky. */
  hours: number;
};

export type WorldProps = {
  model: AdventureModel | null;
  activeDay: number | "all";
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  play: boolean;
  /** Written by the world while the drone flies, read by the HUD. */
  progress: MutableRefObject<{ day: number; t: number }>;
  onArrive: (nodeId: string, day: number) => void;
  onDayDone: (day: number) => void;
  onTick: (day: number, t: number) => void;
  labels: MutableRefObject<Map<string, HTMLElement>>;
  shared: MutableRefObject<Shared>;
  scanning: boolean;
  reduced: boolean;
  introKey: number;
  onUserMove: () => void;
  onReady: () => void;
};

const BG = "#050719";

// ---------- terrain ----------

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const vnoise = (x: number, y: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The ground height at a world point: gentle hills that settle to flat around the play area. */
export const heightAt = (x: number, z: number, extent: number) => {
  const n = 0.55 * vnoise(x * 0.09, z * 0.09) + 0.3 * vnoise(x * 0.2 + 7, z * 0.2 + 3) + 0.15 * vnoise(x * 0.45 + 1, z * 0.45 + 9);
  const r = Math.hypot(x, z);
  const inner = 1 - 0.55 * (1 - smooth(extent * 0.15, extent * 0.9, r)); // flatter in the middle, where the places are
  return n * 2.4 * inner * (1 - smooth(extent * 1.1, extent * 1.7, r) * 0.6) - 0.3;
};

/** Qloo's taste heat as a texture the ground shader glows from. */
function heatTexture(model: AdventureModel | null, size: number): THREE.CanvasTexture {
  const res = 512;
  const c = document.createElement("canvas");
  c.width = c.height = res;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, res, res);
  g.globalCompositeOperation = "lighter";
  const heat = model?.heat ?? [];
  // Radius from how far apart the points are, so the glow joins up into one landscape.
  const gaps = heat.map((h, i) => Math.min(...heat.map((o, j) => (i === j ? Infinity : Math.hypot(h.x - o.x, h.z - o.z)))));
  const sorted = gaps.filter(Number.isFinite).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 3;
  const radius = Math.max(3.4, Math.min(8, median * 1.6));
  for (const h of heat) {
    const px = (h.x / size + 0.5) * res;
    const py = (h.z / size + 0.5) * res;
    const pr = (radius / size) * res;
    const grad = g.createRadialGradient(px, py, 0, px, py, pr);
    const a = Math.min(1, h.w * 0.9);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.5, `rgba(255,255,255,${a * 0.45})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const terrainVert = /* glsl */ `
varying vec3 vW;
varying float vH;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vH = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const terrainFrag = /* glsl */ `
precision highp float;
varying vec3 vW;
varying float vH;
uniform float uTime;
uniform float uSize;
uniform sampler2D uHeat;
uniform vec3 uSel;      // xz = selected place, y = on (0/1)
uniform float uSelT;
uniform float uHeatOn;
float grid(vec2 p, float s){
  vec2 q = p / s;
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(0.0001));
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main(){
  vec2 uv = vW.xz / uSize + 0.5;
  float heat = texture2D(uHeat, uv).r * uHeatOn;
  vec3 deep = vec3(0.016, 0.022, 0.075);
  vec3 hill = vec3(0.07, 0.06, 0.2);
  vec3 col = mix(deep, hill, smoothstep(-0.3, 2.2, vH));
  float g1 = grid(vW.xz, 1.0) * 0.12;
  float g2 = grid(vW.xz, 6.0) * 0.38;
  float cl = vH * 2.2;
  float contour = 1.0 - min(abs(fract(cl - 0.5) - 0.5) / max(fwidth(cl), 0.0001), 1.0);
  col += vec3(0.28, 0.4, 1.0) * g1 + vec3(0.55, 0.38, 1.0) * g2 + vec3(0.2, 0.85, 1.0) * contour * 0.16;
  // Qloo: where the taste lives, glowing from the ground
  vec3 hc = mix(vec3(1.0, 0.31, 0.64), vec3(1.0, 0.72, 0.28), smoothstep(0.5, 1.0, heat));
  float pulse = 0.82 + 0.18 * sin(uTime * 1.6 + heat * 9.0 + vW.x * 0.12);
  col += hc * pow(heat, 1.3) * 0.8 * pulse;
  col += hc * smoothstep(0.6, 1.0, heat) * g1 * 1.2;
  // ripple from the selected place
  float d = length(vW.xz - uSel.xy);
  float ring = smoothstep(1.4, 0.0, abs(d - uSelT * 22.0)) * (1.0 - uSelT) * uSel.z;
  col += vec3(0.4, 0.9, 1.0) * ring * 0.9;
  float edge = smoothstep(uSize * 0.5, uSize * 0.26, length(vW.xz));
  col = mix(vec3(0.02, 0.027, 0.098), col, edge);
  gl_FragColor = vec4(col, 1.0);
}`;

function Terrain({ model, selected, shared }: { model: AdventureModel | null; selected: QuestNode | null; shared: MutableRefObject<Shared> }) {
  const extent = model?.extent ?? 30;
  const size = extent * 3.2;
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(size, size, 168, 168);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i), extent));
    return g;
  }, [size, extent]);
  const tex = useMemo(() => heatTexture(model, size), [model, size]);
  useEffect(() => () => tex.dispose(), [tex]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: terrainVert,
        fragmentShader: terrainFrag,
        uniforms: { uTime: { value: 0 }, uSize: { value: size }, uHeat: { value: tex }, uSel: { value: new THREE.Vector3() }, uSelT: { value: 1 }, uHeatOn: { value: 1 } },
        extensions: { derivatives: true } as never,
      }),
    [size, tex]
  );
  const selStart = useRef(0);
  const lastSel = useRef<string | null>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    mat.uniforms.uTime.value = t;
    if ((selected?.id ?? null) !== lastSel.current) {
      lastSel.current = selected?.id ?? null;
      selStart.current = t;
    }
    const u = Math.min(1, (t - selStart.current) / 1.4);
    mat.uniforms.uSelT.value = u;
    if (selected) mat.uniforms.uSel.value.set(selected.x, selected.z, 1);
    else mat.uniforms.uSel.value.z = 0;
    mat.uniforms.uHeatOn.value += ((model?.heat.length ? 1 : 0) - mat.uniforms.uHeatOn.value) * 0.04;
    void shared;
  });
  useEffect(() => () => { geom.dispose(); mat.dispose(); }, [geom, mat]);
  return <mesh geometry={geom} material={mat} />;
}

// ---------- sky and air ----------

const skyFrag = /* glsl */ `
varying vec3 vDir;
uniform vec3 uHorizon;
uniform float uTime;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -0.2, 1.0);
  vec3 zenith = vec3(0.012, 0.016, 0.06);
  vec3 col = mix(uHorizon, zenith, pow(max(up, 0.0), 0.5));
  // stars
  vec2 sp = vec2(atan(d.z, d.x) * 90.0, d.y * 90.0);
  vec2 cell = floor(sp);
  float star = step(0.9965, h21(cell)) * smoothstep(0.1, 0.4, d.y) * (0.6 + 0.4 * sin(uTime * 2.0 + h21(cell + 3.0) * 20.0));
  col += vec3(star);
  // slow aurora ribbon
  float band = sin(d.x * 3.0 + uTime * 0.15) * 0.5 + sin(d.z * 2.3 - uTime * 0.11) * 0.5;
  float aur = smoothstep(0.25, 0.0, abs(d.y - 0.28 - band * 0.06)) * 0.22;
  col += mix(vec3(0.2, 0.9, 1.0), vec3(1.0, 0.3, 0.7), 0.5 + 0.5 * band) * aur;
  gl_FragColor = vec4(col, 1.0);
}`;

/** The horizon colour for a time of day: night violet, dawn rose, day teal, dusk magenta. Pure. */
export function horizonFor(hours: number): THREE.Color {
  const stops: [number, string][] = [[0, "#1d1052"], [5, "#2a1460"], [6.5, "#ff7a8a"], [9, "#2b78d8"], [15, "#2a8bd0"], [17.5, "#ff8a5a"], [19, "#c0307a"], [21, "#2a1460"], [24, "#1d1052"]];
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < hours) i++;
  const [h0, c0] = stops[i - 1];
  const [h1, c1] = stops[i];
  const f = Math.max(0, Math.min(1, (hours - h0) / (h1 - h0 || 1)));
  return new THREE.Color(c0).lerp(new THREE.Color(c1), f);
}

function Sky({ shared }: { shared: MutableRefObject<Shared> }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: skyFrag,
        uniforms: { uHorizon: { value: new THREE.Color("#1d1052") }, uTime: { value: 0 } },
      }),
    []
  );
  const cur = useRef(new THREE.Color("#1d1052"));
  useFrame(({ clock }, dt) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
    cur.current.lerp(horizonFor(shared.current.hours), 1 - Math.exp(-dt * 1.5));
    mat.uniforms.uHorizon.value.copy(cur.current);
  });
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh renderOrder={-10}>
      <sphereGeometry args={[320, 32, 20]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

function Particles({ extent, reduced }: { extent: number; reduced: boolean }) {
  const count = 520;
  const ref = useRef<THREE.Points>(null);
  const { geom, speeds } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sp = new Float32Array(count);
    const a = new THREE.Color("#38d3ff");
    const b = new THREE.Color("#ff4fa3");
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * extent * 3;
      pos[i * 3 + 1] = Math.random() * 22;
      pos[i * 3 + 2] = (Math.random() - 0.5) * extent * 3;
      const c = a.clone().lerp(b, Math.random());
      col.set([c.r, c.g, c.b], i * 3);
      sp[i] = 0.15 + Math.random() * 0.5;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return { geom: g, speeds: sp };
  }, [extent]);
  useFrame((_, dt) => {
    if (reduced || !ref.current) return;
    const p = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = p.getY(i) + speeds[i] * dt;
      if (y > 22) y = 0;
      p.setY(i, y);
    }
    p.needsUpdate = true;
  });
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial size={0.14} vertexColors transparent opacity={0.65} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
    </points>
  );
}

// ---------- Qloo: taste columns ----------

const beamVert = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const beamFrag = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uTime;
uniform float uPower;
uniform float uOn;
void main(){
  float fade = pow(1.0 - vUv.y, 1.6);
  float lines = 0.65 + 0.35 * sin(vUv.y * 26.0 - uTime * 2.4 + uPower * 7.0);
  gl_FragColor = vec4(uColor, fade * lines * uPower * uOn * 0.7);
}`;

function beamMaterial(color: THREE.Color, power: number) {
  return new THREE.ShaderMaterial({ vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uColor: { value: color }, uTime: { value: 0 }, uPower: { value: power }, uOn: { value: 1 } } });
}

function TasteBeams({ model }: { model: AdventureModel }) {
  const items = useMemo(() => {
    const top = [...model.heat].sort((a, b) => b.w - a.w).slice(0, 9).filter((h) => h.w >= 0.4);
    return top.map((h) => ({ h, y: heightAt(h.x, h.z, model.extent), mat: beamMaterial(new THREE.Color("#ff4fa3").lerp(new THREE.Color("#ffb547"), Math.max(0, (h.w - 0.5) * 2)), 0.35 + h.w * 0.35) }));
  }, [model]);
  const zone = model.zone;
  const zoneMat = useMemo(() => beamMaterial(new THREE.Color("#ffd27a"), 1), []);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (const i of items) i.mat.uniforms.uTime.value = t;
    zoneMat.uniforms.uTime.value = t;
    if (ring.current) ring.current.rotation.z = t * 0.25;
  });
  useEffect(() => () => { for (const i of items) i.mat.dispose(); zoneMat.dispose(); }, [items, zoneMat]);
  return (
    <group>
      {items.map(({ h, y, mat }, i) => (
        <mesh key={i} position={[h.x, y + (2 + h.w * 4) / 2, h.z]} material={mat}>
          <cylinderGeometry args={[0.08 + h.w * 0.14, 0.3 + h.w * 0.3, 2 + h.w * 4, 20, 1, true]} />
        </mesh>
      ))}
      {zone && (
        <group position={[zone.x, heightAt(zone.x, zone.z, model.extent) + 0.08, zone.z]}>
          <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[zone.r - 0.14, zone.r, 96, 1]} />
            <meshBasicMaterial color="#ffd27a" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[zone.r * 0.62, zone.r * 0.64, 96, 1]} />
            <meshBasicMaterial color="#ff4fa3" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 6, 0]} material={zoneMat}>
            <cylinderGeometry args={[0.35, zone.r * 0.16, 12, 24, 1, true]} />
          </mesh>
        </group>
      )}
    </group>
  );
}

// ---------- quest markers ----------

const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function geometryFor(kind: QuestNode["kind"], h: number): THREE.BufferGeometry {
  switch (kind) {
    case "stay":
      return new THREE.BoxGeometry(0.95, h, 0.95).translate(0, h / 2, 0);
    case "dine":
      return new THREE.ConeGeometry(0.6, h, 6).translate(0, h / 2, 0);
    case "venue":
      return new THREE.CylinderGeometry(0.95, 1.05, h * 0.55, 8).translate(0, (h * 0.55) / 2, 0);
    case "activity":
      return new THREE.OctahedronGeometry(0.62).translate(0, h * 0.7, 0);
    case "landmark":
      return new THREE.CylinderGeometry(0.1, 0.38, h * 2.2, 4).translate(0, h * 1.1, 0);
    default:
      return new THREE.SphereGeometry(0.3, 14, 12).translate(0, 0.5, 0);
  }
}

const NodeMarker = memo(function NodeMarker({ node, extent, selected, hovered, born, onSelect, onHover, reduced }: { node: QuestNode; extent: number; selected: boolean; hovered: boolean; born: number; onSelect: (id: string) => void; onHover: (id: string | null) => void; reduced: boolean }) {
  const color = useMemo(() => new THREE.Color(KIND_COLOR[node.kind]), [node.kind]);
  const h = (0.9 + (node.match ?? 0.5) * 1.8) * (node.picked ? 1.15 : 0.65);
  const geom = useMemo(() => geometryFor(node.kind, h), [node.kind, h]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geom), [geom]);
  const y = heightAt(node.x, node.z, extent) + 0.05;
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const burst = useRef<THREE.Mesh>(null);
  const beam = useMemo(() => beamMaterial(color.clone(), node.picked ? 0.9 : 0), [color, node.picked]);
  useEffect(() => () => { geom.dispose(); edges.dispose(); beam.dispose(); }, [geom, edges, beam]);
  const live = useRef({ sel: 0 });
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const age = t - born;
    const grow = reduced ? 1 : Math.max(0, Math.min(1, age * 1.7));
    const s = reduced ? 1 : easeOutBack(grow);
    live.current.sel += ((selected ? 1 : hovered ? 0.5 : 0) - live.current.sel) * Math.min(1, dt * 9);
    if (root.current) root.current.scale.setScalar(Math.max(0.0001, s) * 1.5 * (1 + live.current.sel * 0.28));
    if (body.current) {
      body.current.rotation.y = node.kind === "activity" || node.kind === "landmark" ? t * 0.9 : Math.sin(t * 0.5 + node.x) * 0.15;
      if (node.kind === "activity") body.current.position.y = Math.sin(t * 1.4 + node.z) * 0.18;
    }
    if (halo.current) {
      const k = node.picked ? 1 + 0.12 * Math.sin(t * 2.4 + node.x) : 1;
      halo.current.scale.setScalar(k * (1 + live.current.sel * 0.6));
    }
    if (burst.current) {
      const b = Math.max(0, Math.min(1, (age - 0.1) / 1.1));
      burst.current.scale.setScalar(0.2 + b * 4.2);
      (burst.current.material as THREE.MeshBasicMaterial).opacity = reduced ? 0 : (1 - b) * 0.8 * (b > 0 && b < 1 ? 1 : 0);
    }
    beam.uniforms.uTime.value = t;
  });
  return (
    <group position={[node.x, y, node.z]}>
      <group ref={root} scale={0.0001}>
        <group ref={body}>
          <mesh geometry={geom}>
            <meshBasicMaterial color={color} transparent opacity={node.picked ? 0.24 : 0.1} depthWrite={false} />
          </mesh>
          <lineSegments geometry={edges}>
            <lineBasicMaterial color={color} transparent opacity={node.picked ? 0.98 : 0.5} />
          </lineSegments>
        </group>
        <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[0.85, 1.05, 48]} />
          <meshBasicMaterial color={color} transparent opacity={node.picked ? 0.95 : 0.45} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {node.picked && (
          <mesh position={[0, 4.2, 0]} material={beam}>
            <cylinderGeometry args={[0.03, 0.07, 8.4, 8, 1, true]} />
          </mesh>
        )}
        {node.match != null && node.match >= 0.8 && node.picked && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
            <ringGeometry args={[1.35, 1.42, 64]} />
            <meshBasicMaterial color="#ffd27a" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
      <mesh ref={burst} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
        <ringGeometry args={[0.9, 1, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        position={[0, 0.9, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
          onHover(node.id);
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
          onHover(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
      >
        <sphereGeometry args={[1.25, 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
});

function Markers({ model, selectedId, hoverId, onSelect, onHover, reduced }: { model: AdventureModel; selectedId: string | null; hoverId: string | null; onSelect: (id: string) => void; onHover: (id: string | null) => void; reduced: boolean }) {
  const clock = useThree((s) => s.clock);
  // Each place pops in the first time it appears, one after another, so results land as they stream in.
  const born = useRef(new Map<string, number>());
  const order = useRef(0);
  const now = clock.elapsedTime;
  for (const n of model.nodes) if (!born.current.has(n.id)) born.current.set(n.id, now + 0.9 + order.current++ * 0.09);
  return (
    <>
      {model.nodes.map((n) => (
        <NodeMarker key={n.id} node={n} extent={model.extent} selected={selectedId === n.id} hovered={hoverId === n.id} born={born.current.get(n.id) ?? now} onSelect={onSelect} onHover={onHover} reduced={reduced} />
      ))}
    </>
  );
}

// ---------- routes and the drone ----------

const routeFrag = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uLen;
uniform float uProgress;
uniform float uGlow;
void main(){
  float flow = fract(vUv.x * uLen * 0.35 - uTime * 0.55);
  float pulse = smoothstep(0.0, 0.1, flow) * smoothstep(0.32, 0.1, flow);
  float done = step(vUv.x, uProgress);
  vec3 c = mix(uColor, vec3(1.0), done * 0.45);
  float a = uOpacity * (uGlow > 0.5 ? 0.18 : (0.3 + 0.7 * pulse + done * 0.4));
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}`;

type RouteGeo = { route: DayRoute; curve: THREE.CatmullRomCurve3; tube: THREE.TubeGeometry; wide: THREE.TubeGeometry; mat: THREE.ShaderMaterial; glow: THREE.ShaderMaterial; length: number };

function useRouteGeos(model: AdventureModel): RouteGeo[] {
  const geos = useMemo(() => {
    const out: RouteGeo[] = [];
    for (const r of model.routes) {
      if (r.path.length < 2) continue;
      const pts = r.path.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z, model.extent) + 0.5, z));
      const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      const length = curve.getLength();
      const seg = Math.min(600, Math.max(40, pts.length * 10));
      const make = (glow: boolean) =>
        new THREE.ShaderMaterial({ vertexShader: beamVert, fragmentShader: routeFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(r.color) }, uTime: { value: 0 }, uOpacity: { value: 1 }, uLen: { value: length }, uProgress: { value: 0 }, uGlow: { value: glow ? 1 : 0 } } });
      out.push({ route: r, curve, tube: new THREE.TubeGeometry(curve, seg, 0.065, 6, false), wide: new THREE.TubeGeometry(curve, seg, 0.2, 8, false), mat: make(false), glow: make(true), length });
    }
    return out;
  }, [model]);
  useEffect(() => () => { for (const g of geos) { g.tube.dispose(); g.wide.dispose(); g.mat.dispose(); g.glow.dispose(); } }, [geos]);
  return geos;
}

function Routes({ geos, activeDay, progress }: { geos: RouteGeo[]; activeDay: number | "all"; progress: MutableRefObject<{ day: number; t: number }> }) {
  useFrame(({ clock }, dt) => {
    for (const g of geos) {
      const on = activeDay === "all" || activeDay === g.route.day;
      for (const m of [g.mat, g.glow]) {
        m.uniforms.uTime.value = clock.elapsedTime;
        const target = on ? 1 : 0.1;
        m.uniforms.uOpacity.value += (target - m.uniforms.uOpacity.value) * Math.min(1, dt * 6);
        m.uniforms.uProgress.value = progress.current.day === g.route.day ? progress.current.t : 0;
      }
    }
  });
  return (
    <group>
      {geos.map((g) => (
        <group key={g.route.day}>
          <mesh geometry={g.wide} material={g.glow} />
          <mesh geometry={g.tube} material={g.mat} />
        </group>
      ))}
    </group>
  );
}

function Drone({ geos, activeDay, play, progress, onArrive, onDayDone, onTick, shared, reduced, extent }: { geos: RouteGeo[]; activeDay: number | "all"; play: boolean; progress: MutableRefObject<{ day: number; t: number }>; onArrive: (id: string, day: number) => void; onDayDone: (day: number) => void; onTick: (day: number, t: number) => void; shared: MutableRefObject<Shared>; reduced: boolean; extent: number }) {
  const root = useRef<THREE.Group>(null);
  const core = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const trailGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    return g;
  }, []);
  const trailN = useRef(0);
  const last = useRef({ day: -1, t: 0, tick: 0, visible: 0 });
  const prevT = useRef(0);
  const prevDay = useRef(-1);
  useEffect(() => () => trailGeom.dispose(), [trailGeom]);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const dayNow = progress.current.day;
    const g = geos.find((x) => x.route.day === dayNow) ?? geos.find((x) => activeDay === "all" || x.route.day === activeDay) ?? null;
    const showing = Boolean(g) && (play || progress.current.t > 0);
    last.current.visible += ((showing ? 1 : 0) - last.current.visible) * Math.min(1, dt * 6);
    if (root.current) root.current.visible = last.current.visible > 0.02;
    if (!g) return;
    if (prevDay.current !== g.route.day) {
      prevDay.current = g.route.day;
      prevT.current = progress.current.t;
      trailN.current = 0;
    }
    if (play) {
      const secs = Math.max(9, Math.min(24, g.length / 5.5));
      progress.current.t = Math.min(1, progress.current.t + dt / secs);
    }
    const tt = progress.current.t;
    const p = g.curve.getPointAt(Math.max(0, Math.min(1, tt)));
    const ahead = g.curve.getPointAt(Math.min(1, tt + 0.01));
    const heading = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    const hover = 1.15 + Math.sin(t * 3) * 0.08;
    if (root.current) root.current.position.set(p.x, p.y + hover, p.z);
    if (core.current) core.current.rotation.y = t * 2.2;
    if (ring.current) ring.current.rotation.z = t * 3;
    shared.current.drone.pos.set(p.x, p.y + hover, p.z);
    shared.current.drone.heading = heading;
    // trail
    const pos = trailGeom.attributes.position as THREE.BufferAttribute;
    if (play && !reduced) {
      for (let i = 47; i > 0; i--) pos.setXYZ(i, pos.getX(i - 1), pos.getY(i - 1), pos.getZ(i - 1));
      pos.setXYZ(0, p.x, p.y + hover - 0.1, p.z);
      trailN.current = Math.min(48, trailN.current + 1);
      trailGeom.setDrawRange(0, trailN.current);
      pos.needsUpdate = true;
    }
    // the clock on screen follows the stop being approached
    const upcoming = g.route.stops.find((s) => s.at >= tt - 1e-6) ?? g.route.stops[g.route.stops.length - 1];
    const quest = upcoming ? g.route.quests.find((q) => q.nodeId === upcoming.nodeId) : null;
    const hrs = hoursOf(quest?.time);
    if (play && hrs != null) shared.current.hours = hrs;
    if (play) {
      for (const s of g.route.stops) if (prevT.current < s.at && tt >= s.at) onArrive(s.nodeId, g.route.day);
      if (prevT.current < 1 && tt >= 1) onDayDone(g.route.day);
    }
    prevT.current = tt;
    last.current.tick += dt;
    if (last.current.tick > 0.12) {
      last.current.tick = 0;
      onTick(g.route.day, tt);
    }
    void extent;
  });
  return (
    <>
      <group ref={root} visible={false}>
        <group ref={core}>
          <mesh>
            <octahedronGeometry args={[0.34]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
          </mesh>
          <lineSegments>
            <edgesGeometry args={[new THREE.OctahedronGeometry(0.5)]} />
            <lineBasicMaterial color="#38d3ff" />
          </lineSegments>
        </group>
        <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.72, 0.025, 8, 48]} />
          <meshBasicMaterial color="#ff4fa3" transparent opacity={0.9} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh position={[0, -2.2, 0]}>
          <cylinderGeometry args={[0.02, 0.18, 4.4, 8, 1, true]} />
          <meshBasicMaterial color="#38d3ff" transparent opacity={0.25} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <points geometry={trailGeom}>
        <pointsMaterial size={0.34} color="#7fe6ff" transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
      </points>
    </>
  );
}

// ---------- the radar, while the agent is still searching ----------

const sweepFrag = /* glsl */ `
varying vec2 vUv;
uniform float uOpacity;
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float sweep = smoothstep(0.0, 1.0, 1.0 - mod(a, 6.2831853) / 1.2);
  float inside = step(r, 1.0) * step(mod(a, 6.2831853), 1.2);
  gl_FragColor = vec4(0.22, 0.83, 1.0, inside * sweep * 0.5 * uOpacity * (1.0 - r * 0.6));
}`;

function Radar({ on, extent }: { on: boolean; extent: number }) {
  const sweep = useRef<THREE.Mesh>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: beamVert, fragmentShader: sweepFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uOpacity: { value: 0 } } }), []);
  const k = useRef(0);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }, dt) => {
    k.current += ((on ? 1 : 0) - k.current) * Math.min(1, dt * 2.5);
    mat.uniforms.uOpacity.value = k.current;
    if (sweep.current) {
      sweep.current.visible = k.current > 0.02;
      sweep.current.rotation.z = -clock.elapsedTime * 1.6;
    }
    rings.current.forEach((m, i) => {
      if (!m) return;
      const f = (clock.elapsedTime * 0.38 + i / 3) % 1;
      m.scale.setScalar(0.05 + f * extent * 1.3);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.65 * k.current;
      m.visible = k.current > 0.02;
    });
  });
  return (
    <group position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={sweep} material={mat}>
        <planeGeometry args={[extent * 2.2, extent * 2.2]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { rings.current[i] = m; }}>
          <ringGeometry args={[0.97, 1, 96]} />
          <meshBasicMaterial color="#38d3ff" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- camera ----------

function Rig({ model, selected, shared, play, reduced, introKey, labels, onUserMove, onReady }: { model: AdventureModel | null; selected: QuestNode | null; shared: MutableRefObject<Shared>; play: boolean; reduced: boolean; introKey: number; labels: MutableRefObject<Map<string, HTMLElement>>; onUserMove: () => void; onReady: () => void }) {
  const { camera, gl, size } = useThree();
  const extent = model?.extent ?? 30;
  const span = useMemo(() => Math.max(10, ...(model?.nodes ?? []).map((n) => Math.hypot(n.x, n.z))), [model]);
  const dist = Math.min(extent * 2.4, Math.max(20, span * 2.1 + 4));
  const overview = useMemo(() => ({ pos: new THREE.Vector3(0.08, 0.62, 0.78).normalize().multiplyScalar(dist), target: new THREE.Vector3(0, 0, 0) }), [dist]);
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 6;
    c.maxDistance = extent * 3.2;
    c.maxPolarAngle = Math.PI * 0.47;
    c.minPolarAngle = 0.15;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.7;
    return c;
  }, [camera, gl, extent]);
  useEffect(() => {
    const touch = () => onUserMove();
    controls.addEventListener("start", touch);
    return () => {
      controls.removeEventListener("start", touch);
      controls.dispose();
    };
  }, [controls, onUserMove]);

  const intro = useRef({ start: 0, running: true });
  const lastSel = useRef<string | null>(null);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), t: new THREE.Vector3(), off: new THREE.Vector3(), q: new THREE.Vector3() }), []);
  const idle = useRef(0);
  const readied = useRef(false);

  useEffect(() => {
    // Dive in from high above.
    intro.current = { start: -1, running: !reduced };
    if (reduced) {
      camera.position.copy(overview.pos);
      controls.target.copy(overview.target);
    } else {
      camera.position.set(extent * 0.4, extent * 3.4, extent * 2.8);
      controls.target.set(0, 0, 0);
    }
    controls.update();
  }, [introKey, reduced, camera, controls, overview, extent]);

  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime;
    if (!readied.current) {
      readied.current = true;
      onReady();
    }
    const sh = shared.current;
    if (intro.current.running) {
      if (intro.current.start < 0) intro.current.start = now;
      const f = Math.min(1, (now - intro.current.start) / 3.4);
      const e = 1 - Math.pow(1 - f, 3);
      const spin = (1 - e) * 0.9;
      tmp.v.set(extent * 0.4, extent * 3.4, extent * 2.8).lerp(overview.pos, e);
      const ang = spin;
      tmp.q.set(tmp.v.x * Math.cos(ang) - tmp.v.z * Math.sin(ang), tmp.v.y, tmp.v.x * Math.sin(ang) + tmp.v.z * Math.cos(ang));
      camera.position.copy(tmp.q);
      controls.target.copy(overview.target);
      controls.enabled = false;
      if (f >= 1) {
        intro.current.running = false;
        controls.enabled = true;
      }
      controls.update();
      projectLabels();
      return;
    }
    controls.enabled = true;
    const k = 1 - Math.exp(-dt * 3.2);
    if (sh.follow && play) {
      const f = sh.drone.heading;
      tmp.t.copy(sh.drone.pos);
      tmp.v.set(tmp.t.x - Math.sin(f) * 17, tmp.t.y + 10, tmp.t.z - Math.cos(f) * 17);
      camera.position.lerp(tmp.v, k * 0.8);
      controls.target.lerp(tmp.t, k * 1.2);
      idle.current = 0;
    } else if (now < sh.homeUntil) {
      camera.position.lerp(overview.pos, k);
      controls.target.lerp(overview.target, k);
    } else if (selected && now < sh.focusUntil) {
      const y = heightAt(selected.x, selected.z, extent);
      tmp.t.set(selected.x, y + 1, selected.z);
      tmp.off.copy(camera.position).sub(controls.target);
      tmp.off.y = Math.max(tmp.off.y, 6);
      tmp.off.setLength(Math.min(Math.max(tmp.off.length(), 20), 26));
      tmp.v.copy(tmp.t).add(tmp.off);
      camera.position.lerp(tmp.v, k);
      controls.target.lerp(tmp.t, k);
    } else if (!reduced && !selected && !play) {
      idle.current += dt;
      controls.autoRotate = idle.current > 7;
      controls.autoRotateSpeed = 0.5;
    }
    if (selected?.id !== lastSel.current) {
      lastSel.current = selected?.id ?? null;
      idle.current = 0;
    }
    if (selected || play) controls.autoRotate = false;
    controls.update();
    projectLabels();
  });

  const v = useMemo(() => new THREE.Vector3(), []);
  function projectLabels() {
    if (!model) return;
    const w = size.width;
    const h = size.height;
    const sel = selected?.id ?? null;
    const dist = camera.position.distanceTo(controls.target);
    const cand: { n: QuestNode; x: number; y: number; z: number; prio: number }[] = [];
    for (const n of model.nodes) {
      const el = labels.current.get(n.id);
      if (!el) continue;
      v.set(n.x, heightAt(n.x, n.z, extent) + (0.9 + (n.match ?? 0.5) * 1.8) * 1.3 + 0.8, n.z).project(camera);
      const rank = n.match ?? 0;
      const near = n.picked && (dist < extent * 0.9 || (dist < extent * 2.4 && rank >= 0.86));
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (!onScreen || !(n.id === sel || near)) {
        el.style.opacity = "0";
        continue;
      }
      cand.push({ n, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, z: v.z, prio: n.id === sel ? 10 : rank });
    }
    // Keep the most relevant labels and hide any that would sit on top of one already placed.
    cand.sort((a, b) => b.prio - a.prio);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const c of cand) {
      const el = labels.current.get(c.n.id)!;
      const half = (26 + c.n.name.length * 6.8) / 2;
      const box = { x0: c.x - half, x1: c.x + half, y0: c.y - 30, y1: c.y };
      const clash = c.n.id !== sel && placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
      if (clash) {
        el.style.opacity = "0";
        continue;
      }
      placed.push(box);
      el.style.opacity = c.n.id === sel ? "1" : "0.88";
      el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) translate(-50%, -100%)`;
      el.style.zIndex = c.n.id === sel ? "4" : String(Math.round((1 - c.z) * 100));
    }
  }
  return null;
}

// ---------- the scene ----------

function Scene(p: WorldProps) {
  const { model } = p;
  const selected = useMemo(() => model?.nodes.find((n) => n.id === p.selectedId) ?? null, [model, p.selectedId]);
  const geos = useRouteGeos(model ?? EMPTY);
  return (
    <>
      <color attach="background" args={[BG]} />
      <Sky shared={p.shared} />
      <Terrain model={model} selected={selected} shared={p.shared} />
      <Particles extent={model?.extent ?? 30} reduced={p.reduced} />
      <Radar on={p.scanning || !model} extent={model?.extent ?? 30} />
      {model && (
        <>
          <TasteBeams model={model} />
          <Routes geos={geos} activeDay={p.activeDay} progress={p.progress} />
          <Markers model={model} selectedId={p.selectedId} hoverId={p.hoverId} onSelect={p.onSelect} onHover={p.onHover} reduced={p.reduced} />
          <Drone geos={geos} activeDay={p.activeDay} play={p.play} progress={p.progress} onArrive={p.onArrive} onDayDone={p.onDayDone} onTick={p.onTick} shared={p.shared} reduced={p.reduced} extent={model.extent} />
        </>
      )}
      <Rig model={model} selected={selected} shared={p.shared} play={p.play} reduced={p.reduced} introKey={p.introKey} labels={p.labels} onUserMove={p.onUserMove} onReady={p.onReady} />
      {/* clicking empty ground clears the selection */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} onClick={() => p.onSelect(null)}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}

const EMPTY: AdventureModel = { title: "", city: "", sample: false, nodes: [], routes: [], heat: [], zone: null, extent: 30, scale: 1, taste: null, intel: null, travel: null, center: { lat: 0, lon: 0 }, origin: null, destination: null, summary: null, stats: { places: 0, picked: 0, km: 0, match: null, xp: 0, days: 0 } };

function World(props: WorldProps) {
  return (
    <Canvas
      flat
      dpr={[1, 1.75]}
      camera={{ fov: 48, near: 0.1, far: 900, position: [20, 70, 80] }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      onPointerMissed={() => undefined}
      style={{ position: "absolute", inset: 0 }}
    >
      <Scene {...props} />
    </Canvas>
  );
}

export default memo(World);
