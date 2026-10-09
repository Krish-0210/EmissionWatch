// R3F idiom: three.js objects and control refs are mutated inside useFrame.
/* oxlint-disable react/immutability */
import { holdBusy, holdState } from '../lib/hold'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { ClusterSummary } from '../api'
import { easeInOut, easeOut, span } from '../lib/motion'
import { faceRotation, kmToUnits, latLonToVec3, wrapAngle } from './geo'
import { heroDist, heroOffset } from './layout'

export interface GlobePin {
  id: string
  x: number // CSS px in the canvas
  y: number
  vis: boolean // on the visible hemisphere
}

export interface GlobeControl {
  progress: number // 0..1 scroll progress through the home stage
  dragging: boolean
  dragYaw: number
  dragPitch: number
  mouseX: number // -1..1
  mouseY: number
  active?: boolean // set by the scene: something is moving, keep rendering
  intro?: number // 0 = intro still running (satellite hidden), 1 = handed over (default)
  paused?: boolean // intro: render nothing until it hands over (the first frame still renders)
  scan?: { idx: number; t: number } // scan request from the hero button: cluster index, performance.now()
  hover?: number // index of the hovered cluster, -1 for none
  pins?: GlobePin[] // screen positions of the clusters, written every frame
}

interface Props {
  clusters: ClusterSummary[]
  focusId: string
  control: MutableRefObject<GlobeControl>
  lite: boolean
  glow: boolean // cheap additive halo instead of bloom
}

const SIGNAL = new THREE.Color('#7ce8d8')
const EMBER = new THREE.Color('#ff8a3d')
const TEX_BASE = `${import.meta.env.BASE_URL}textures/`
const INDIA = { lat: 22.5, lon: 81.5 }
const fract = (x: number) => x - Math.floor(x)

// Textures decode off the main thread (ImageBitmap) and upload as soon as they arrive (initTexture),
// so neither the decode nor the upload lands in a frame mid-animation.
const bitmaps = typeof createImageBitmap === 'function' ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY' }) : null
function loadTex(name: string, gl: THREE.WebGLRenderer, opts: { red?: boolean; aniso?: number; srgb?: boolean } = {}) {
  const t = new THREE.Texture()
  if (opts.red) t.format = THREE.RedFormat // single-channel upload: 1/4 of the GPU memory
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.anisotropy = opts.aniso ?? 4
  t.wrapS = THREE.RepeatWrapping
  const done = (img: ImageBitmap | HTMLImageElement) => {
    t.image = img
    t.flipY = !bitmaps // an ImageBitmap is already flipped at decode
    t.needsUpdate = true
    gl.initTexture(t)
  }
  if (bitmaps) bitmaps.load(TEX_BASE + name, done)
  else new THREE.ImageLoader().load(TEX_BASE + name, done)
  return t
}

/* ---------- Earth: night lights, land/ocean tint, borders, graticule, terminator, global NO2 ---------- */
const earthShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv; varying vec3 vNw; varying vec3 vPw;
    void main() {
      vUv = uv;
      vNw = normalize(mat3(modelMatrix) * normal);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vPw = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMask; uniform sampler2D uLights; uniform sampler2D uNo2;
    uniform vec3 uSun; uniform float uNo2Opacity; uniform float uLightBoost; uniform float uGrid;
    varying vec2 vUv; varying vec3 vNw; varying vec3 vPw;
    float line(float x, float w) { float d = abs(fract(x - 0.5) - 0.5); return 1.0 - smoothstep(0.0, fwidth(x) * w, d); }
    void main() {
      vec3 m = texture2D(uMask, vUv).rgb;
      float land = m.r, border = m.g, india = m.b;
      float lights = texture2D(uLights, vUv).r;
      vec4 no2 = texture2D(uNo2, vUv);
      vec3 n = normalize(vNw);
      vec3 v = normalize(cameraPosition - vPw);
      float day = smoothstep(-0.06, 0.22, dot(n, uSun));

      vec3 oceanN = vec3(0.014, 0.04, 0.062), oceanD = vec3(0.035, 0.13, 0.18);
      vec3 landN = vec3(0.05, 0.095, 0.11), landD = vec3(0.13, 0.25, 0.27);
      vec3 col = mix(mix(oceanN, oceanD, day), mix(landN, landD, day), land);
      col += india * vec3(0.03, 0.06, 0.065);
      // City lights on the night side, a hint on the day side.
      col += vec3(1.0, 0.72, 0.42) * pow(lights, 1.25) * mix(1.25, 0.12, day) * uLightBoost;
      // Coastline, country borders (India brighter), graticule.
      float coast = smoothstep(0.25, 0.5, land) - smoothstep(0.5, 0.75, land);
      vec3 teal = vec3(0.486, 0.91, 0.847);
      col += teal * (coast * 0.16 + border * 0.22 + india * border * 0.25);
      float indiaEdge = smoothstep(0.2, 0.5, india) - smoothstep(0.5, 0.8, india);
      col += teal * indiaEdge * 0.35;
      float g = max(line(vUv.x * 24.0, 1.2), line(vUv.y * 12.0, 1.2));
      col += teal * g * 0.035 * uGrid;
      // Global NO2 hotspots, soft.
      col = mix(col, no2.rgb * (0.7 + 0.5 * (1.0 - day)), no2.a * uNo2Opacity);
      // Inner rim light.
      float f = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      col += teal * f * 0.2;
      gl_FragColor = vec4(col, 1.0);
    }`,
}

function Earth({ lite, sun, no2, grid }: { lite: boolean; sun: THREE.Vector3; no2: MutableRefObject<number>; grid: MutableRefObject<number> }) {
  const gl = useThree((s) => s.gl)
  const uniforms = useMemo(
    () => ({
      uMask: { value: loadTex('earth_mask.webp', gl) },
      uLights: { value: loadTex(lite ? 'night_lights_1k.webp' : 'night_lights.webp', gl, { red: true, aniso: lite ? 2 : 8 }) },
      uNo2: { value: loadTex('no2_world_2024.webp', gl) },
      uSun: { value: sun },
      uNo2Opacity: { value: 0.6 },
      uLightBoost: { value: 1 },
      uGrid: { value: 1 },
    }),
    [lite, sun, gl],
  )
  useEffect(
    () => () => {
      uniforms.uMask.value.dispose()
      uniforms.uLights.value.dispose()
      uniforms.uNo2.value.dispose()
    },
    [uniforms],
  )
  useFrame(() => {
    uniforms.uNo2Opacity.value = no2.current
    uniforms.uGrid.value = grid.current
  })
  return (
    <mesh renderOrder={0}>
      <sphereGeometry args={[1, lite ? 64 : 96, lite ? 48 : 72]} />
      <shaderMaterial uniforms={uniforms} vertexShader={earthShader.vertexShader} fragmentShader={earthShader.fragmentShader} />
    </mesh>
  )
}

/* ---------- Clouds: thin drifting layer, dimmer on the night side ---------- */
const cloudShader = {
  vertexShader: earthShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMap; uniform vec3 uSun; uniform float uShift; uniform float uOpacity;
    varying vec2 vUv; varying vec3 vNw; varying vec3 vPw;
    void main() {
      float c = texture2D(uMap, vec2(vUv.x + uShift, vUv.y)).r;
      float day = smoothstep(-0.2, 0.4, dot(normalize(vNw), uSun));
      float a = smoothstep(0.25, 0.9, c) * uOpacity * (0.35 + 0.65 * day);
      gl_FragColor = vec4(mix(vec3(0.55, 0.68, 0.75), vec3(0.85, 0.92, 0.95), day), a);
    }`,
}
function Clouds({ sun, opacity }: { sun: THREE.Vector3; opacity: MutableRefObject<number> }) {
  const gl = useThree((s) => s.gl)
  const uniforms = useMemo(
    () => ({ uMap: { value: loadTex('clouds.webp', gl, { red: true }) }, uSun: { value: sun }, uShift: { value: 0 }, uOpacity: { value: 0.22 } }),
    [sun, gl],
  )
  useEffect(() => () => uniforms.uMap.value.dispose(), [uniforms])
  useFrame((_, dt) => {
    uniforms.uShift.value = (uniforms.uShift.value + Math.min(dt, 0.1) * 0.0018) % 1
    uniforms.uOpacity.value = opacity.current
  })
  return (
    <mesh scale={1.006} renderOrder={1}>
      <sphereGeometry args={[1, 64, 48]} />
      <shaderMaterial uniforms={uniforms} vertexShader={cloudShader.vertexShader} fragmentShader={cloudShader.fragmentShader} transparent depthWrite={false} />
    </mesh>
  )
}

/* ---------- Halo: one additive camera-facing sprite, the cheap stand-in for bloom ---------- */
function Halo({ strength }: { strength: MutableRefObject<number> }) {
  const mat = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    // Globe radius 1 inside a sprite of radius 1.5: the rim sits at 0.667.
    g.addColorStop(0, 'rgba(124,232,216,0)')
    g.addColorStop(0.62, 'rgba(124,232,216,0)')
    g.addColorStop(0.67, 'rgba(124,232,216,0.2)')
    g.addColorStop(0.78, 'rgba(124,232,216,0.06)')
    g.addColorStop(1, 'rgba(124,232,216,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  }, [])
  useEffect(
    () => () => {
      mat.map?.dispose()
      mat.dispose()
    },
    [mat],
  )
  useFrame(() => {
    mat.opacity = strength.current
  })
  return <sprite material={mat} scale={[3, 3, 1]} renderOrder={-1} />
}

/* ---------- NO2 texture draped on India (higher resolution than the global layer) ---------- */
const no2Shader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMap; uniform float uOpacity; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(uMap, vUv);
      float edge = smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x) * smoothstep(0.0, 0.07, vUv.y) * smoothstep(1.0, 0.93, vUv.y);
      gl_FragColor = vec4(c.rgb * 1.25, c.a * edge * uOpacity);
      #include <colorspace_fragment>
    }`,
}
function No2Layer({ opacity }: { opacity: MutableRefObject<number> }) {
  const gl = useThree((s) => s.gl)
  const uniforms = useMemo(() => {
    const t = loadTex('no2_india_2024.webp', gl, { srgb: true })
    t.wrapS = THREE.ClampToEdgeWrapping
    return { uMap: { value: t }, uOpacity: { value: 0.8 } }
  }, [gl])
  useEffect(() => () => uniforms.uMap.value.dispose(), [uniforms])
  const d = THREE.MathUtils.degToRad
  useFrame(() => {
    uniforms.uOpacity.value = opacity.current
  })
  return (
    <mesh renderOrder={2}>
      <sphereGeometry args={[1.0015, 96, 96, d(68 + 180), d(30), d(90 - 37), d(31)]} />
      <shaderMaterial uniforms={uniforms} vertexShader={no2Shader.vertexShader} fragmentShader={no2Shader.fragmentShader} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/* ---------- Atmosphere: Fresnel rim on the limb + outer glow shell (teal) ---------- */
const rimShader = {
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  rimFragment: /* glsl */ `
    uniform vec3 uColor; uniform float uStrength;
    varying vec3 vN; varying vec3 vV;
    void main() {
      float f = 1.0 - abs(dot(vN, vV));
      gl_FragColor = vec4(uColor * 1.2, pow(f, 5.0) * 0.2 * uStrength);
    }`,
  shellFragment: /* glsl */ `
    uniform vec3 uColor; uniform float uStrength;
    varying vec3 vN; varying vec3 vV;
    void main() {
      // Back faces of a 1.09 shell: 0 at the shell's edge, rising toward the Earth's limb (|n.v| ~ 0.4).
      float a = clamp(-dot(vN, vV) / 0.4, 0.0, 1.0);
      gl_FragColor = vec4(uColor, a * a * 0.26 * uStrength);
    }`,
}
function Atmosphere({ strength }: { strength: MutableRefObject<number> }) {
  const rim = useMemo(() => ({ uColor: { value: SIGNAL }, uStrength: { value: 1 } }), [])
  const shell = useMemo(() => ({ uColor: { value: SIGNAL }, uStrength: { value: 1 } }), [])
  useFrame(() => {
    rim.uStrength.value = strength.current
    shell.uStrength.value = strength.current
  })
  return (
    <>
      <mesh scale={1.012} renderOrder={3}>
        <sphereGeometry args={[1, 64, 64]} />
        <shaderMaterial uniforms={rim} vertexShader={rimShader.vertexShader} fragmentShader={rimShader.rimFragment} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh scale={1.09} renderOrder={-2}>
        <sphereGeometry args={[1, 64, 64]} />
        <shaderMaterial uniforms={shell} vertexShader={rimShader.vertexShader} fragmentShader={rimShader.shellFragment} transparent depthWrite={false} side={THREE.BackSide} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </>
  )
}

/* ---------- Plumes: rising ember particles at cluster coordinates; the hovered one flares ---------- */
const plumeShader = {
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uScale; uniform float uPx; uniform float uHover; uniform float uHold;
    attribute vec3 aNormal; attribute vec3 aTangent; attribute float aSeed; attribute float aHeight; attribute float aBright; attribute float aCluster;
    varying float vA;
    void main() {
      float hot = 1.0 - step(0.5, abs(aCluster - uHover));
      float t = fract(uTime * (0.05 + 0.05 * fract(aSeed * 7.13)) + aSeed);
      vec3 bit = cross(aNormal, aTangent);
      float ang = aSeed * 43.0 + uTime * 0.4;
      float h = aHeight * (1.0 + 0.6 * hot) * (1.0 + 2.4 * uHold);
      float spread = (0.004 + 0.035 * t) * h * 4.0;
      vec3 p = position + aNormal * (t * h * uScale)
             + (aTangent * cos(ang) + bit * sin(ang)) * spread * uScale;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uPx * (0.6 + aBright) * (1.0 + 0.5 * hot) * (1.0 + 0.9 * uHold) * (1.0 - 0.5 * t) / -mv.z, 1.0, 22.0);
      vA = smoothstep(0.0, 0.08, t) * (1.0 - t) * (0.3 + 0.7 * aBright) * (1.0 + 0.8 * hot) * (1.0 + 1.4 * uHold);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(uColor * 1.9, smoothstep(0.5, 0.0, d) * vA);
    }`,
}
function Plumes({ clusters, total, scale, control }: { clusters: ClusterSummary[]; total: number; scale: MutableRefObject<number>; control: MutableRefObject<GlobeControl> }) {
  const { gl } = useThree()
  const geo = useMemo(() => {
    const pos: number[] = [], nor: number[] = [], tan: number[] = [], seed: number[] = [], height: number[] = [], bright: number[] = [], idx: number[] = []
    const up = new THREE.Vector3(0, 1, 0)
    // A fixed particle budget shared by risk: higher scores get taller, denser plumes.
    const weight = (c: ClusterSummary) => 0.35 + 0.65 * (c.risk_score / 100)
    const sum = clusters.reduce((a, c) => a + weight(c), 0)
    clusters.forEach((c, ci) => {
      const s = c.risk_score / 100
      const n = latLonToVec3(c.lat, c.lon).normalize()
      const t = new THREE.Vector3().crossVectors(up, n).normalize()
      const count = Math.floor((total * weight(c)) / sum)
      for (let i = 0; i < count; i++) {
        pos.push(n.x * 1.002, n.y * 1.002, n.z * 1.002)
        nor.push(n.x, n.y, n.z)
        tan.push(t.x, t.y, t.z)
        seed.push(fract(Math.sin((i + 1) * 12.9898 + c.lat * 78.233) * 43758.5453))
        height.push(0.04 + 0.13 * s)
        bright.push(0.25 + 0.75 * s)
        idx.push(ci)
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aNormal', new THREE.Float32BufferAttribute(nor, 3))
    g.setAttribute('aTangent', new THREE.Float32BufferAttribute(tan, 3))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
    g.setAttribute('aHeight', new THREE.Float32BufferAttribute(height, 1))
    g.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1))
    g.setAttribute('aCluster', new THREE.Float32BufferAttribute(idx, 1))
    return g
  }, [clusters, total])
  useEffect(() => () => geo.dispose(), [geo])
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uScale: { value: 1 }, uPx: { value: 9 }, uHover: { value: -1 }, uHold: { value: 0 }, uColor: { value: EMBER } }), [])
  useFrame((_, dt) => {
    // Hold to scan: plumes flare (taller, bigger, brighter) and rise faster; the release pulses them.
    const blast = holdState.blastAt ? Math.exp(-((performance.now() - holdState.blastAt) / 1000) * 4) * holdState.blastLevel : 0
    uniforms.uHold.value = Math.min(1.4, holdState.level + 0.8 * blast)
    uniforms.uTime.value += Math.min(dt, 0.1) * (1 + 2.5 * holdState.level)
    uniforms.uScale.value = scale.current
    uniforms.uPx.value = 9 * gl.getPixelRatio()
    uniforms.uHover.value = control.current.hover ?? -1
  })
  return (
    <points geometry={geo} frustumCulled={false} renderOrder={4}>
      <shaderMaterial uniforms={uniforms} vertexShader={plumeShader.vertexShader} fragmentShader={plumeShader.fragmentShader} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </points>
  )
}

/* ---------- Method rings around the focus cluster: 10 km, 20 km, 50–80 km background ---------- */
function Rings({ lat, lon, reveal }: { lat: number; lon: number; reveal: MutableRefObject<number> }) {
  const mats = useRef<THREE.MeshBasicMaterial[]>([])
  const { position, quaternion } = useMemo(() => {
    const n = latLonToVec3(lat, lon).normalize()
    return {
      position: n.clone().multiplyScalar(1.0008),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n),
    }
  }, [lat, lon])
  const rings = useMemo(() => {
    const w = kmToUnits(0.45)
    return [
      { r0: kmToUnits(10) - w, r1: kmToUnits(10) + w, op: 1, delay: 0 },
      { r0: kmToUnits(20) - w, r1: kmToUnits(20) + w, op: 0.9, delay: 0.15 },
      { r0: kmToUnits(50), r1: kmToUnits(80), op: 0.09, delay: 0.3 },
      { r0: kmToUnits(50) - w, r1: kmToUnits(50) + w, op: 0.45, delay: 0.3 },
      { r0: kmToUnits(80) - w, r1: kmToUnits(80) + w, op: 0.45, delay: 0.3 },
    ]
  }, [])
  useFrame(() => {
    const k = reveal.current
    for (let i = 0; i < rings.length; i++) {
      const m = mats.current[i]
      if (m) m.opacity = rings[i].op * span(k, rings[i].delay, rings[i].delay + 0.55)
    }
  })
  return (
    <group position={position} quaternion={quaternion} renderOrder={3}>
      {rings.map((r, i) => (
        <mesh key={i}>
          <ringGeometry args={[r.r0, r.r1, 160]} />
          <meshBasicMaterial
            ref={(m) => {
              if (m) mats.current[i] = m
            }}
            color={SIGNAL}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/* ---------- Satellite: orbit over India with a fading trail, glow, and scan beams to clusters ---------- */
const trailShader = {
  vertexShader: /* glsl */ `
    attribute float aAng; varying float vAng;
    void main() { vAng = aAng; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uSat; uniform float uFade; uniform vec3 uColor; varying float vAng;
    void main() {
      float behind = mod(uSat - vAng, 6.2831853);
      float trail = pow(clamp(1.0 - behind / 1.7, 0.0, 1.0), 2.2);
      gl_FragColor = vec4(uColor, (0.09 + 0.85 * trail) * uFade);
    }`,
}
const beamShader = {
  vertexShader: /* glsl */ `
    varying float vY;
    void main() { vY = position.y + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uA; uniform vec3 uColor; varying float vY;
    void main() { gl_FragColor = vec4(uColor, uA * (0.15 + 0.85 * smoothstep(0.0, 1.0, vY))); }`,
}
const R_ORBIT = 1.32
function Satellite({ fade, clusters, lite, control }: { fade: MutableRefObject<number>; clusters: ClusterSummary[]; lite: boolean; control: MutableRefObject<GlobeControl> }) {
  const sat = useRef<THREE.Group>(null)
  const glow = useRef<THREE.Sprite>(null)
  const beam = useRef<THREE.Mesh>(null)
  const ping = useRef<THREE.Mesh>(null)
  const { a, b, line, trailU } = useMemo(() => {
    const a = latLonToVec3(INDIA.lat, INDIA.lon).normalize()
    const tilt = new THREE.Vector3(0.35, 1, 0.1).normalize()
    const b = new THREE.Vector3().crossVectors(a, tilt).normalize()
    const pts: number[] = [], ang: number[] = []
    const N = 384
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2
      const p = a.clone().multiplyScalar(Math.cos(t) * R_ORBIT).addScaledVector(b, Math.sin(t) * R_ORBIT)
      pts.push(p.x, p.y, p.z)
      ang.push(t)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setAttribute('aAng', new THREE.Float32BufferAttribute(ang, 1))
    const trailU = { uSat: { value: 0 }, uFade: { value: 1 }, uColor: { value: SIGNAL } }
    const mat = new THREE.ShaderMaterial({ uniforms: trailU, vertexShader: trailShader.vertexShader, fragmentShader: trailShader.fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    return { a, b, line: new THREE.Line(g, mat), trailU }
  }, [])
  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line],
  )
  const glowMat = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(210,255,248,1)')
    g.addColorStop(0.25, 'rgba(124,232,216,0.6)')
    g.addColorStop(1, 'rgba(124,232,216,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  }, [])
  useEffect(() => () => glowMat.map?.dispose(), [glowMat])
  const beamU = useMemo(() => ({ uA: { value: 0 }, uColor: { value: SIGNAL } }), [])
  const pingMat = useMemo(() => new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), [])
  const dirs = useMemo(() => clusters.map((c) => latLonToVec3(c.lat, c.lon).normalize()), [clusters])
  const st = useRef({ t: -0.9, cool: 1.5, beamT: -1, target: -1, scanSeen: 0, len: 1.6 })
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), up: new THREE.Vector3(), g: new THREE.Vector3(), e: new THREE.Vector3(), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }), [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const s = st.current
    // Scan request (hero button): sweep the satellite to the orbit point above the cluster, then beam.
    const req = control.current.scan
    let sweeping = false
    if (req && req.t !== s.scanSeen) {
      s.scanSeen = req.t
      s.target = req.idx
      s.beamT = -1
    }
    const sinceScan = req ? (performance.now() - req.t) / 1000 : 99
    if (req && sinceScan < 0.75 && s.target === req.idx) {
      const d = dirs[req.idx]
      const want = Math.atan2(d.dot(b), d.dot(a))
      const diff = Math.atan2(Math.sin(want - s.t), Math.cos(want - s.t))
      s.t += diff * Math.min(1, dt * 7)
      sweeping = true
    } else s.t += dt * 0.22
    if (req && !sweeping && sinceScan < 1 && s.beamT < 0 && s.target === req.idx) {
      s.beamT = 0
      s.len = 2.6
    }
    const p = tmp.p.copy(a).multiplyScalar(Math.cos(s.t) * R_ORBIT).addScaledVector(b, Math.sin(s.t) * R_ORBIT)
    const f = fade.current
    if (sat.current) {
      sat.current.position.copy(p)
      sat.current.lookAt(0, 0, 0)
      sat.current.visible = f > 0.02
    }
    if (glow.current) {
      glow.current.position.copy(p)
      glowMat.opacity = f * (0.75 + 0.25 * Math.sin(s.t * 9))
    }
    trailU.uSat.value = ((s.t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    trailU.uFade.value = f

    // Scan beam: when the satellite passes over a cluster, point at it for ~1.6 s.
    s.cool -= dt
    if (s.beamT < 0 && s.cool <= 0 && f > 0.5 && sinceScan > 3) {
      const up = tmp.up.copy(p).normalize()
      let best = -1, bestDot = Math.cos(THREE.MathUtils.degToRad(16))
      dirs.forEach((d, i) => {
        const k = d.dot(up)
        if (k > bestDot) {
          bestDot = k
          best = i
        }
      })
      if (best >= 0) {
        s.target = best
        s.beamT = 0
        s.len = 1.6
      }
    }
    const bm = beam.current, pg = ping.current
    if (s.beamT >= 0 && bm && pg) {
      s.beamT += dt
      const k = s.beamT / s.len
      const ground = dirs[s.target]
      const g = tmp.g.copy(ground).multiplyScalar(1.004)
      const len = p.distanceTo(g)
      bm.position.copy(p).add(g).multiplyScalar(0.5)
      bm.scale.set(1, len, 1)
      // +Y (narrow end) points from the ground up to the satellite.
      bm.quaternion.setFromUnitVectors(tmp.y, tmp.e.copy(p).sub(g).normalize())
      beamU.uA.value = f * 0.55 * Math.sin(Math.min(1, k) * Math.PI)
      pg.position.copy(ground).multiplyScalar(1.003)
      pg.quaternion.setFromUnitVectors(tmp.z, ground)
      const r = 0.01 + 0.07 * easeOut(Math.min(1, k * 1.3))
      pg.scale.setScalar(r)
      pingMat.opacity = f * 0.8 * (1 - Math.min(1, k))
      bm.visible = pg.visible = true
      if (k >= 1) {
        s.beamT = -1
        s.cool = 4 + (s.target % 3)
      }
    } else if (bm && pg) bm.visible = pg.visible = false
  })
  return (
    <>
      <primitive object={line} />
      <sprite ref={glow} material={glowMat} scale={[lite ? 0.09 : 0.11, lite ? 0.09 : 0.11, 1]} renderOrder={6} />
      <group ref={sat} scale={0.022}>
        <mesh>
          <boxGeometry args={[0.9, 0.9, 1.4]} />
          <meshBasicMaterial color="#c9d4de" />
        </mesh>
        <mesh position={[1.6, 0, 0]}>
          <boxGeometry args={[2.2, 0.05, 0.9]} />
          <meshBasicMaterial color="#3d6a8c" />
        </mesh>
        <mesh position={[-1.6, 0, 0]}>
          <boxGeometry args={[2.2, 0.05, 0.9]} />
          <meshBasicMaterial color="#3d6a8c" />
        </mesh>
        <mesh position={[0, 0, 0.85]}>
          <sphereGeometry args={[0.28, 12, 12]} />
          <meshBasicMaterial color={SIGNAL} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={beam} visible={false} renderOrder={5}>
        <cylinderGeometry args={[0.002, 0.03, 1, 20, 1, true]} />
        <shaderMaterial uniforms={beamU} vertexShader={beamShader.vertexShader} fragmentShader={beamShader.fragmentShader} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ping} visible={false} material={pingMat} renderOrder={5}>
        <ringGeometry args={[0.8, 1, 64]} />
      </mesh>
    </>
  )
}

/* ---------- Starfield: far points with a few twinkling, slight parallax with the pointer ---------- */
const starShader = {
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uPx;
    attribute float aSize; attribute float aTw; varying float vA;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uPx;
      vA = aTw > 0.0 ? 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (1.2 + aTw * 2.5) + aTw * 40.0)) : 0.55 + 0.3 * fract(aSize * 7.0);
    }`,
  fragmentShader: /* glsl */ `
    varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(vec3(0.85, 0.92, 1.0), smoothstep(0.5, 0.1, d) * vA);
    }`,
}
function Stars({ count, control }: { count: number; control: MutableRefObject<GlobeControl> }) {
  const group = useRef<THREE.Points>(null)
  const { gl } = useThree()
  const geo = useMemo(() => {
    const pos = new Float32Array(count * 3), size = new Float32Array(count), tw = new Float32Array(count)
    const v = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      const r = (k: number) => fract(Math.sin((i + 1) * 12.9898 * k + 78.233) * 43758.5453)
      v.set(r(1) * 2 - 1, r(2) * 2 - 1, r(3) * 2 - 1).normalize().multiplyScalar(22 + r(4) * 8)
      pos.set([v.x, v.y, v.z], i * 3)
      size[i] = 0.6 + Math.pow(r(5), 6) * 2.6
      tw[i] = r(6) < 0.08 ? r(7) : 0
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aTw', new THREE.BufferAttribute(tw, 1))
    return g
  }, [count])
  useEffect(() => () => geo.dispose(), [geo])
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPx: { value: 1 } }), [])
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1)
    uniforms.uPx.value = gl.getPixelRatio()
    const g = group.current
    if (g) {
      // Opposite drift to the globe's parallax: the far field lags behind.
      g.rotation.y += (-control.current.mouseX * 0.025 - g.rotation.y) * Math.min(1, dt * 2)
      g.rotation.x += (-control.current.mouseY * 0.018 - g.rotation.x) * Math.min(1, dt * 2)
    }
  })
  return (
    <points ref={group} geometry={geo} frustumCulled={false} renderOrder={-3}>
      <shaderMaterial uniforms={uniforms} vertexShader={starShader.vertexShader} fragmentShader={starShader.fragmentShader} transparent depthWrite={false} />
    </points>
  )
}

/* ---------- Scene ---------- */
export default function GlobeScene({ clusters, focusId, control, lite, glow }: Props) {
  const globe = useRef<THREE.Group>(null)
  const { camera, size, gl, scene } = useThree()
  // Compile every shader up front (rings included), so nothing compiles mid-scroll.
  useEffect(() => {
    void gl.compileAsync(scene, camera)
  }, [gl, scene, camera])
  const focus = clusters.find((c) => c.id === focusId) ?? clusters[0]
  const indiaRot = useMemo(() => faceRotation(INDIA.lat, INDIA.lon), [])
  const focusRot = useMemo(() => faceRotation(focus.lat, focus.lon), [focus])
  const free = useRef({ yaw: indiaRot.yaw - 0.9, pitch: indiaRot.pitch * 0.6 })
  const no2India = useRef(0.85)
  const no2World = useRef(0.6)
  const grid = useRef(1)
  const cloudOp = useRef(0.2)
  const rimStrength = useRef(1)
  const plumeScale = useRef(1)
  const ringReveal = useRef(0)
  const satFade = useRef(1)
  const haloStrength = useRef(1)
  const smooth = useRef({ p: 0, mx: 0, my: 0, intro: control.current.intro ?? 1, clock: 0 })
  const sun = useMemo(() => new THREE.Vector3(-0.8, 0.25, -0.4).normalize(), [])
  const tmp = useMemo(() => ({ cam: new THREE.Vector3(), target: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3() }), [])
  const local = useMemo(() => clusters.map((c) => latLonToVec3(c.lat, c.lon).normalize()), [clusters])
  const faceRot = useMemo(() => clusters.map((c) => faceRotation(c.lat, c.lon)), [clusters])
  const narrow = size.width < 768

  useEffect(() => {
    control.current.pins = clusters.map((c) => ({ id: c.id, x: 0, y: 0, vis: false }))
  }, [clusters, control])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    const c = control.current
    const s = smooth.current
    s.clock += dt
    s.p += (c.progress - s.p) * Math.min(1, dt * 6)
    s.mx += (c.mouseX - s.mx) * Math.min(1, dt * 3)
    s.my += (c.mouseY - s.my) * Math.min(1, dt * 3)
    s.intro += ((c.intro ?? 1) - s.intro) * Math.min(1, dt * 5)
    const p = s.p
    const d1 = easeInOut(span(p, 0.12, 0.32)) // overview -> India
    const d2 = easeInOut(span(p, 0.36, 0.54)) // India -> focus cluster

    // Slow terminator sweep: the sun sits to the left, behind the globe, and swings slowly, so the
    // day/night line drifts across the visible face.
    const sa = Math.PI - 0.62 + 0.45 * Math.sin(s.clock * 0.045)
    sun.set(Math.cos(sa), 0.28, Math.sin(sa)).normalize()

    // Free rotation: auto-rotate + drag, only meaningful in the hero. A scan turns the scanned
    // cluster toward the camera (a little off-centre, so its plume shows against the limb glow).
    const scanAge = c.scan ? (performance.now() - c.scan.t) / 1000 : 99
    if (scanAge < 2.4 && d1 < 0.02 && !c.dragging) {
      const f = faceRot[c.scan!.idx]
      const k = Math.min(1, dt * 3.2)
      free.current.yaw += wrapAngle(f.yaw - 0.25 - free.current.yaw) * k
      free.current.pitch += (f.pitch * 0.8 - free.current.pitch) * k
    } else if (!c.dragging && d1 < 0.02 && (c.hover ?? -1) < 0) free.current.yaw += dt * (0.07 + 0.35 * holdState.level) // holds still under a tooltip
    free.current.yaw += c.dragYaw
    free.current.pitch = THREE.MathUtils.clamp(free.current.pitch + c.dragPitch, -0.9, 0.9)
    c.dragYaw = 0
    c.dragPitch = 0

    const fy = free.current.yaw
    const yawIndia = fy + wrapAngle(indiaRot.yaw - fy) * d1
    const pitchIndia = THREE.MathUtils.lerp(free.current.pitch, indiaRot.pitch, d1)
    const yaw = yawIndia + wrapAngle(focusRot.yaw - yawIndia) * d2
    const pitch = THREE.MathUtils.lerp(pitchIndia, focusRot.pitch, d2)

    // Camera: hero -> India -> oblique close-up over the cluster (altitude ~0.075 ≈ 480 km).
    const d0 = heroDist(narrow)
    const off = heroOffset(narrow)
    // Hold to scan: the camera dives toward the globe and shakes; the release kicks it back out.
    const hl = holdState.level
    const kick = holdState.blastAt ? Math.exp(-((performance.now() - holdState.blastAt) / 1000) * 5) * holdState.blastLevel : 0
    const dist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(d0, 2.05, d1), 1.085, d2) * (1 - 0.16 * hl * (1 - 0.8 * d2) + 0.06 * kick)
    const g = globe.current
    if (g) {
      g.rotation.set(pitch, yaw, 0, 'XYZ')
      g.position.set(off.x * (1 - d1), off.y * (1 - d1), 0)
    }
    const shake = 0.006 * hl * hl
    tmp.cam.set(s.mx * 0.12 * (1 - d1) + shake * Math.sin(s.clock * 53), -s.my * 0.08 * (1 - d1) - 0.05 * d2 + shake * Math.sin(s.clock * 61 + 1), dist)
    tmp.target.set(0, 0, THREE.MathUtils.lerp(0, 1, d2))
    camera.position.copy(tmp.cam)
    camera.lookAt(tmp.target)

    no2India.current = 0.85 + 0.15 * d1 + 0.45 * hl + 0.4 * kick
    no2World.current = 0.6 * (1 - 0.5 * d2)
    grid.current = 1 - d2
    cloudOp.current = 0.2 * (1 - 0.7 * d1)
    rimStrength.current = 1 - 0.85 * d2
    plumeScale.current = THREE.MathUtils.lerp(1, 0.09, d2)
    ringReveal.current = span(p, 0.42, 0.6)
    satFade.current = (1 - d2) * span(s.intro, 0.4, 1)
    haloStrength.current = 1 - d2 + 0.7 * hl + 0.8 * kick

    // Screen positions of the clusters for hover and click (hero only).
    const pins = c.pins
    if (g && pins && pins.length === local.length) {
      g.updateMatrixWorld()
      camera.updateMatrixWorld()
      for (let i = 0; i < local.length; i++) {
        const w = tmp.v.copy(local[i]).multiplyScalar(1.01).applyMatrix4(g.matrixWorld)
        const n = tmp.n.copy(w).sub(g.position).normalize()
        const facing = n.dot(tmp.target.copy(camera.position).sub(w).normalize())
        w.project(camera)
        pins[i].x = ((w.x + 1) / 2) * size.width
        pins[i].y = ((1 - w.y) / 2) * size.height
        pins[i].vis = facing > 0.15 && p < 0.1 && s.intro > 0.95
      }
    }

    // Keep rendering while the globe auto-rotates (hero), is dragged, or scroll/parallax/intro is still settling.
    const settling =
      Math.abs(c.progress - s.p) > 1e-4 || Math.abs(c.mouseX - s.mx) > 1e-3 || Math.abs(c.mouseY - s.my) > 1e-3 || Math.abs((c.intro ?? 1) - s.intro) > 1e-3
    c.active = d1 < 0.02 || c.dragging || settling || scanAge < 4.5 || holdBusy()
  })

  return (
    <>
      <Stars count={lite ? 500 : 1400} control={control} />
      <group ref={globe}>
        <Earth lite={lite} sun={sun} no2={no2World} grid={grid} />
        {!lite && <Clouds sun={sun} opacity={cloudOp} />}
        <No2Layer opacity={no2India} />
        <Atmosphere strength={rimStrength} />
        {glow && <Halo strength={haloStrength} />}
        <Plumes clusters={clusters} total={lite ? 600 : 1400} scale={plumeScale} control={control} />
        <Rings lat={focus.lat} lon={focus.lon} reveal={ringReveal} />
        <Satellite fade={satFade} clusters={clusters} lite={lite} control={control} />
      </group>
    </>
  )
}
