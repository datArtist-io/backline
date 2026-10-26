"use client";

// Hero light sculpture: a slowly breathing form in stage-gel colours.
// It floats gently and swells with the user's voice. It doesn't react to the cursor (by design: calm).
import { memo, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { voice } from "@/lib/voice";

// 3D simplex noise by Ian McEwan, Ashima Arts (MIT licence).
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uSeed;
uniform vec2 uPointer;
varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;
${NOISE}
void main() {
  float n  = snoise(normal * 1.05 + vec3(uTime * 0.11 + uSeed));
  float n2 = snoise(normal * 2.3  - vec3(uTime * 0.07 - uSeed));
  float d  = n * 0.22 + n2 * 0.07;
  vec3 pdir = normalize(vec3(uPointer, 0.7));
  d += max(dot(normal, pdir), 0.0) * 0.14 * length(uPointer);
  d *= 1.0 + uAmp * 1.8;
  vec3 pos = position + normal * d;
  vNoise = n;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vView = normalize(-mv.xyz);
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uD;
varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;
void main() {
  float t = vNoise * 0.5 + 0.5;
  vec3 col = mix(uA, uB, smoothstep(0.05, 0.6, t));
  col = mix(col, uC, smoothstep(0.5, 1.0, t));
  float band = 0.5 + 0.5 * sin(vNormal.y * 3.0 + vNormal.x * 1.5 + uTime * 0.35);
  col = mix(col, uD, band * 0.32);
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.4);
  col = mix(col, vec3(1.0), fres * 0.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Stage-lighting gels
const GEL = {
  magenta: "#ff4fa3",
  violet: "#7b5cff",
  amber: "#ffb547",
  cyan: "#38d3ff",
};

// Defined once at module level: new arrays on each render would rebuild the shader
// uniforms and restart the animation every time anything on the page changed.
type Palette = [string, string, string, string];
const BLOBS: { position: [number, number, number]; scale: number; seed: number; colors: Palette; detail: number }[] = [
  { position: [0.4, -1.15, 0], scale: 1.95, seed: 0.3, colors: [GEL.violet, GEL.magenta, GEL.amber, GEL.cyan], detail: 48 },
  { position: [-3.6, 1.4, -1.5], scale: 0.55, seed: 2.1, colors: [GEL.cyan, GEL.violet, GEL.magenta, GEL.amber], detail: 24 },
  { position: [3.9, 1.9, -2], scale: 0.38, seed: 4.7, colors: [GEL.amber, GEL.magenta, GEL.violet, GEL.cyan], detail: 16 },
];

function Blob({
  position,
  scale,
  seed,
  colors,
  still,
  detail = 96,
}: {
  position: [number, number, number];
  scale: number;
  seed: number;
  colors: [string, string, string, string];
  still: boolean;
  detail?: number;
}) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const smooth = useRef({ amp: 0 });
  // Float clock.
  const spring = useRef({ t: seed * 10 });

  const uniforms = useMemo(
    () => ({
      uTime: { value: seed * 10 },
      uAmp: { value: 0 },
      uSeed: { value: seed },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uA: { value: new THREE.Color(colors[0]) },
      uB: { value: new THREE.Color(colors[1]) },
      uC: { value: new THREE.Color(colors[2]) },
      uD: { value: new THREE.Color(colors[3]) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, colors.join()]
  );

  useFrame((_, delta) => {
    if (!mat.current || !mesh.current) return;
    const s = smooth.current;
    const sp = spring.current;
    const dt = Math.min(delta, 1 / 30);
    sp.t += dt;
    const k = Math.min(1, delta * 4);
    s.amp += (voice.level - s.amp) * k;
    const u = mat.current.uniforms;
    if (!still) u.uTime.value += delta;
    u.uAmp.value = s.amp;
    mesh.current.rotation.y += still ? 0 : delta * 0.05;
    // Gentle float: each form drifts on its own slow, out-of-phase path.
    const fx = still ? 0 : Math.sin(sp.t * 0.35 + seed * 2.1) * 0.12 + Math.sin(sp.t * 0.17 + seed) * 0.06;
    const fy = still ? 0 : Math.sin(sp.t * 0.5 + seed * 1.3) * 0.16 + Math.cos(sp.t * 0.23 + seed * 3) * 0.05;
    mesh.current.position.x = position[0] + fx;
    mesh.current.position.y = position[1] + fy;
  });

  return (
    <mesh ref={mesh} position={position} scale={scale}>
      <icosahedronGeometry args={[1, detail]} />
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} />
    </mesh>
  );
}

function Scene({ onReady }: { onReady?: () => void }) {
  const still =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 7], fov: 40 }}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      frameloop={still ? "demand" : "always"}
      onCreated={({ gl, scene, camera }) => {
        // Compile shaders up front, then reveal on the next frame so there's no pop-in.
        gl.compile(scene, camera);
        requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()));
      }}
    >
      {BLOBS.map((b) => (
        <Blob key={b.seed} {...b} still={still} />
      ))}
    </Canvas>
  );
}

// The scene has no props: never re-render it because the page around it changed.
export default memo(Scene);
