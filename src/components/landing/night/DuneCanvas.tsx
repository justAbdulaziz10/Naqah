"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/* ---------- Procedural dunes: value noise, ridged for crests. ---------- */
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Height of the sand at (x, z): long diagonal ridges, softer swells, fine ripples. */
function duneHeight(x: number, z: number) {
  const ridge = 1 - Math.abs(vnoise(x * 0.042 + z * 0.018, z * 0.048 + 3.7) * 2 - 1);
  const swell = vnoise(x * 0.085 + 11.3, z * 0.1 + 5.1);
  const ripple = vnoise(x * 0.26 + 2.2, z * 0.31 + 8.8);
  // The far field rises a little so the horizon reads as a line of dunes.
  const far = THREE.MathUtils.smoothstep(-z, 8, 60) * 1.6;
  return ridge * ridge * 2.4 + swell * 1.2 + ripple * 0.22 + far;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGlow;
  varying vec3 vWorld;
  void main() {
    float h = normalize(vWorld).y;
    float t = clamp(h * 1.7 + 0.06, 0.0, 1.0);
    vec3 c = mix(uHorizon, uTop, pow(t, 0.55));
    float glow = exp(-abs(h - 0.012) * 26.0);
    c = mix(c, uGlow, glow * 0.6);
    gl_FragColor = vec4(c, 1.0);
  }
`;
const STAR_VERT = /* glsl */ `
  attribute float aSize; attribute float aPhase;
  uniform float uTime; uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.62 + 0.38 * sin(uTime * (0.5 + aPhase * 0.9) + aPhase * 6.2831);
    // Stars thin out toward the horizon.
    vAlpha = tw * smoothstep(0.0, 0.18, normalize(position).y);
    gl_PointSize = aSize * uPixelRatio;
  }
`;
const STAR_FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.08, d) * vAlpha;
    gl_FragColor = vec4(0.98, 0.95, 0.88, a);
  }
`;
const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
/** The call: three slow rings leaving the ranch light every ~4.5 s, and a warm pool at the centre. */
const RING_FRAG = /* glsl */ `
  uniform float uTime; uniform float uRings; uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float a = 0.0;
    for (int k = 0; k < 3; k++) {
      float ph = fract(uTime / 4.5 - float(k) / 3.0);
      float ring = smoothstep(0.03, 0.0, abs(r - ph * 0.96));
      a += ring * (1.0 - ph) * (1.0 - ph);
    }
    a *= uRings * 0.75;
    float core = exp(-r * r * 36.0) * 0.85;
    gl_FragColor = vec4(uColor, (a + core) * smoothstep(1.0, 0.75, r));
  }
`;

/** Draws a crescent moon with a soft halo on a canvas, used as a sprite texture. */
function moonTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const c = size / 2;
  const halo = ctx.createRadialGradient(c, c, size * 0.16, c, c, size * 0.5);
  halo.addColorStop(0, "rgba(239,231,214,0.35)");
  halo.addColorStop(1, "rgba(239,231,214,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#efe7d6";
  ctx.beginPath();
  ctx.arc(c, c, size * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(c + size * 0.07, c - size * 0.04, size * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The hero's night: dunes, stars, a low moon, fog, and the ranch light that pulses as NAQAH calls.
 * Renders only while visible; one static frame under reduced motion; everything is disposed on unmount.
 */
export function DuneCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x120d09, 1);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x160f0b, 0.034);
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 500);
    const baseCam = new THREE.Vector3(0, 3.4, 15);
    const lookAt = new THREE.Vector3(0.5, 1.4, -14);
    camera.position.copy(baseCam);
    camera.lookAt(lookAt);

    const disposables: { dispose: () => void }[] = [];

    // Sky dome.
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x0b0806) },
        uHorizon: { value: new THREE.Color(0x3a2742) },
        uGlow: { value: new THREE.Color(0x6b3f3a) },
      },
    });
    const skyGeo = new THREE.SphereGeometry(220, 32, 16);
    scene.add(new THREE.Mesh(skyGeo, skyMat));
    disposables.push(skyGeo, skyMat);

    // Stars on the upper dome.
    const starCount = 1500;
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const phases = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v * 0.96); // Upper cap, slightly above the horizon.
      const r = 180;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.75 + 4;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      sizes[i] = 0.9 + Math.pow(Math.random(), 3) * 2.6;
      phases[i] = Math.random();
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    starGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
    });
    scene.add(new THREE.Points(starGeo, starMat));
    disposables.push(starGeo, starMat);

    // Moon, low at the end side of the sky.
    const moonTex = moonTexture();
    if (moonTex) {
      const moonMat = new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false });
      const moon = new THREE.Sprite(moonMat);
      moon.position.set(-34, 22, -120);
      moon.scale.set(26, 26, 1);
      scene.add(moon);
      disposables.push(moonTex, moonMat);
    }

    // Dunes.
    const duneGeo = new THREE.PlaneGeometry(160, 110, 170, 110);
    duneGeo.rotateX(-Math.PI / 2);
    const pos = duneGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, duneHeight(x, z));
    }
    pos.needsUpdate = true;
    duneGeo.computeVertexNormals();
    const duneMat = new THREE.MeshStandardMaterial({ color: 0x2a1e16, roughness: 0.96, metalness: 0 });
    const dunes = new THREE.Mesh(duneGeo, duneMat);
    dunes.position.z = -30;
    scene.add(dunes);
    disposables.push(duneGeo, duneMat);

    // Light: a warm rim from the horizon, the moon from above, the sky's ambient.
    const rim = new THREE.DirectionalLight(0xd8793a, 1.35);
    rim.position.set(-40, 6, -120);
    scene.add(rim);
    const moonLight = new THREE.DirectionalLight(0xefe7d6, 0.42);
    moonLight.position.set(-30, 40, -60);
    scene.add(moonLight);
    scene.add(new THREE.HemisphereLight(0x3a2742, 0x120d09, 0.7));

    // The ranch: one ember light on the far dunes, with the call's rings on the sand.
    const ranchX = 9;
    const ranchZ = -26; // scene space; the dune mesh is offset by -30 on z
    const ranchY = duneHeight(ranchX, ranchZ + 30) + 0.12;
    const emberGeo = new THREE.SphereGeometry(0.16, 12, 12);
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xffb27a, fog: false });
    const ember = new THREE.Mesh(emberGeo, emberMat);
    ember.position.set(ranchX, ranchY + 0.3, ranchZ);
    scene.add(ember);
    const pool = new THREE.PointLight(0xd8793a, 14, 18, 2);
    pool.position.set(ranchX, ranchY + 1.2, ranchZ);
    scene.add(pool);
    const ringGeo = new THREE.PlaneGeometry(24, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { uTime: { value: 0 }, uRings: { value: reduced ? 0 : 1 }, uColor: { value: new THREE.Color(0xd8793a) } },
    });
    const rings = new THREE.Mesh(ringGeo, ringMat);
    rings.position.set(ranchX, ranchY + 0.05, ranchZ);
    rings.renderOrder = 5;
    scene.add(rings);
    disposables.push(emberGeo, emberMat, ringGeo, ringMat);

    // Size to the host.
    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Phones see a taller slice of sky; widen the view a touch so the dunes stay in frame.
      camera.fov = w < 640 ? 56 : 44;
      camera.updateProjectionMatrix();
      if (reduced) renderer.render(scene, camera);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Pointer parallax and scroll: small, slow.
    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (!reduced) window.addEventListener("pointermove", onPointer, { passive: true });

    let visible = true;
    let frame = 0;
    const clock = new THREE.Clock();
    let announced = false;
    const tick = () => {
      frame = 0;
      if (!visible || document.hidden) return;
      const t = clock.getElapsedTime();
      eased.x += (pointer.x - eased.x) * 0.03;
      eased.y += (pointer.y - eased.y) * 0.03;
      const scroll = Math.min(window.scrollY, 900) / 900;
      camera.position.x = baseCam.x + Math.sin(t * 0.05) * 0.7 + eased.x * 0.6;
      camera.position.y = baseCam.y + Math.sin(t * 0.08) * 0.12 - eased.y * 0.25 - scroll * 1.6;
      camera.position.z = baseCam.z - scroll * 2.5;
      camera.lookAt(lookAt.x + eased.x * 1.2, lookAt.y - scroll * 1.2, lookAt.z);
      (starMat.uniforms.uTime as THREE.IUniform<number>).value = t;
      (ringMat.uniforms.uTime as THREE.IUniform<number>).value = t;
      // The ember breathes with the rings.
      const pulse = 0.5 + 0.5 * Math.sin((t / 4.5) * Math.PI * 2);
      pool.intensity = 11 + pulse * 6;
      renderer.render(scene, camera);
      if (!announced) {
        announced = true;
        setReady(true);
      }
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (reduced) {
        renderer.render(scene, camera);
        setReady(true);
        return;
      }
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible) start();
      },
      { threshold: 0.02 },
    );
    io.observe(el);
    const onVisibility = () => {
      if (!document.hidden) start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden
      className={`absolute inset-0 transition-opacity duration-[1400ms] ease-out ${ready ? "opacity-100" : "opacity-0"}`}
    />
  );
}
