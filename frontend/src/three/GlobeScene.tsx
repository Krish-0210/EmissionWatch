// R3F idiom: three.js objects and control refs are mutated inside useFrame.
/* oxlint-disable react/immutability */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { ClusterSummary } from '../api'
import { easeInOut, span } from '../lib/motion'
import { buildDots, faceRotation, kmToUnits, latLonToVec3, loadLandMask, wrapAngle } from './geo'

export interface GlobeControl {
  progress: number // 0..1 scroll progress through the home stage
  dragging: boolean
  dragYaw: number
  dragPitch: number
  mouseX: number // -1..1
  mouseY: number
}

interface Props {
  clusters: ClusterSummary[]
  focusId: string
  control: MutableRefObject<GlobeControl>
  lite: boolean
}

const SIGNAL = new THREE.Color('#7ce8d8')
const EMBER = new THREE.Color('#ff8a3d')
const TEX_BASE = `${import.meta.env.BASE_URL}textures/`
const INDIA = { lat: 22.5, lon: 81.5 }
const fract = (x: number) => x - Math.floor(x)

/* ---------- Dotted Earth ---------- */
function Dots({ lite }: { lite: boolean }) {
  const [geo, setGeo] = useState<THREE.BufferGeometry>()
  useEffect(() => {
    let live = true
    loadLandMask(TEX_BASE + 'land_mask.png').then((m) => {
      if (!live) return
      const { positions, colors } = buildDots(m, lite ? 16000 : 30000)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      setGeo(g)
    })
    return () => {
      live = false
    }
  }, [lite])
  useEffect(() => () => geo?.dispose(), [geo])
  if (!geo) return null
  return (
    <points geometry={geo}>
      <pointsMaterial vertexColors size={lite ? 2 : 2.2} sizeAttenuation={false} transparent opacity={0.95} depthWrite={false} />
    </points>
  )
}

/* ---------- NO2 texture draped on India ---------- */
const no2Shader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMap; uniform float uOpacity; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(uMap, vUv);
      float edge = smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x) * smoothstep(0.0, 0.07, vUv.y) * smoothstep(1.0, 0.93, vUv.y);
      gl_FragColor = vec4(c.rgb, c.a * edge * uOpacity);
      #include <colorspace_fragment>
    }`,
}
function No2Layer({ opacity }: { opacity: MutableRefObject<number> }) {
  const uniforms = useMemo(() => {
    const t = new THREE.TextureLoader().load(TEX_BASE + 'no2_india_2024.png')
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return { uMap: { value: t }, uOpacity: { value: 0.6 } }
  }, [])
  useEffect(() => () => uniforms.uMap.value.dispose(), [uniforms])
  const d = THREE.MathUtils.degToRad
  useFrame(() => {
    uniforms.uOpacity.value = opacity.current
  })
  return (
    <mesh renderOrder={2}>
      <sphereGeometry args={[1.0015, 96, 96, d(68 + 180), d(30), d(90 - 37), d(31)]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={no2Shader.vertexShader}
        fragmentShader={no2Shader.fragmentShader}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

/* ---------- Atmosphere rim ---------- */
const rimShader = {
  uniforms: { uColor: { value: SIGNAL }, uStrength: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uStrength;
    varying vec3 vN; varying vec3 vV;
    void main() {
      float f = 1.0 - abs(dot(vN, vV));
      float a = pow(f, 4.0) * 0.45 * uStrength;
      gl_FragColor = vec4(uColor * 1.2, a);
    }`,
}
function Atmosphere({ strength }: { strength: MutableRefObject<number> }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => THREE.UniformsUtils.clone(rimShader.uniforms), [])
  useFrame(() => {
    if (mat.current) mat.current.uniforms.uStrength.value = strength.current
  })
  return (
    <mesh scale={1.012}>
      <sphereGeometry args={[1, 64, 64]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={rimShader.vertexShader}
        fragmentShader={rimShader.fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.FrontSide}
        toneMapped={false}
      />
    </mesh>
  )
}

/* ---------- Plumes: rising ember particles at cluster coordinates ---------- */
const plumeShader = {
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uScale; uniform float uPx;
    attribute vec3 aNormal; attribute vec3 aTangent; attribute float aSeed; attribute float aHeight; attribute float aBright;
    varying float vA;
    void main() {
      float t = fract(uTime * (0.05 + 0.05 * fract(aSeed * 7.13)) + aSeed);
      vec3 bit = cross(aNormal, aTangent);
      float ang = aSeed * 43.0 + uTime * 0.4;
      float spread = (0.004 + 0.035 * t) * aHeight * 4.0;
      vec3 p = position + aNormal * (t * aHeight * uScale)
             + (aTangent * cos(ang) + bit * sin(ang)) * spread * uScale;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uPx * (0.6 + aBright) * (1.0 - 0.5 * t) / -mv.z, 1.0, 16.0);
      vA = smoothstep(0.0, 0.08, t) * (1.0 - t) * (0.25 + 0.75 * aBright);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; varying float vA;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.0, d) * vA;
      gl_FragColor = vec4(uColor * 1.6, a);
    }`,
}
function Plumes({ clusters, perCluster, scale }: { clusters: ClusterSummary[]; perCluster: number; scale: MutableRefObject<number> }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const { gl } = useThree()
  const geo = useMemo(() => {
    const pos: number[] = [], nor: number[] = [], tan: number[] = [], seed: number[] = [], height: number[] = [], bright: number[] = []
    const up = new THREE.Vector3(0, 1, 0)
    for (const c of clusters) {
      const s = c.risk_score / 100
      const n = latLonToVec3(c.lat, c.lon).normalize()
      const t = new THREE.Vector3().crossVectors(up, n).normalize()
      const count = Math.round(perCluster * (0.35 + 0.65 * s))
      for (let i = 0; i < count; i++) {
        pos.push(n.x * 1.002, n.y * 1.002, n.z * 1.002)
        nor.push(n.x, n.y, n.z)
        tan.push(t.x, t.y, t.z)
        seed.push(fract(Math.sin((i + 1) * 12.9898 + c.lat * 78.233) * 43758.5453))
        height.push(0.04 + 0.13 * s)
        bright.push(0.2 + 0.8 * s)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aNormal', new THREE.Float32BufferAttribute(nor, 3))
    g.setAttribute('aTangent', new THREE.Float32BufferAttribute(tan, 3))
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
    g.setAttribute('aHeight', new THREE.Float32BufferAttribute(height, 1))
    g.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1))
    return g
  }, [clusters, perCluster])
  useEffect(() => () => geo.dispose(), [geo])
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uScale: { value: 1 }, uPx: { value: 9 }, uColor: { value: EMBER } }),
    [],
  )
  useFrame((_, dt) => {
    uniforms.uTime.value += dt
    uniforms.uScale.value = scale.current
    uniforms.uPx.value = 9 * gl.getPixelRatio()
  })
  return (
    <points geometry={geo} frustumCulled={false} renderOrder={4}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={plumeShader.vertexShader}
        fragmentShader={plumeShader.fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  )
}

/* ---------- Method rings around the focus cluster: 10 km, 20 km, 50–80 km background ---------- */
function Rings({ lat, lon, reveal }: { lat: number; lon: number; reveal: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  const mats = useRef<THREE.MeshBasicMaterial[]>([])
  const { position, quaternion } = useMemo(() => {
    const n = latLonToVec3(lat, lon).normalize()
    return {
      position: n.clone().multiplyScalar(1.0008),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n),
    }
  }, [lat, lon])
  const w = kmToUnits(0.45)
  const rings: { r0: number; r1: number; color: THREE.Color; op: number; delay: number }[] = [
    { r0: kmToUnits(10) - w, r1: kmToUnits(10) + w, color: SIGNAL, op: 1, delay: 0 },
    { r0: kmToUnits(20) - w, r1: kmToUnits(20) + w, color: SIGNAL, op: 0.9, delay: 0.15 },
    { r0: kmToUnits(50), r1: kmToUnits(80), color: SIGNAL, op: 0.09, delay: 0.3 },
    { r0: kmToUnits(50) - w, r1: kmToUnits(50) + w, color: SIGNAL, op: 0.45, delay: 0.3 },
    { r0: kmToUnits(80) - w, r1: kmToUnits(80) + w, color: SIGNAL, op: 0.45, delay: 0.3 },
  ]
  useFrame(() => {
    const k = reveal.current
    if (group.current) group.current.visible = k > 0.001
    rings.forEach((r, i) => {
      const m = mats.current[i]
      if (m) m.opacity = r.op * span(k, r.delay, r.delay + 0.55)
    })
  })
  return (
    <group ref={group} position={position} quaternion={quaternion} renderOrder={3}>
      {rings.map((r, i) => (
        <mesh key={i}>
          <ringGeometry args={[r.r0, r.r1, 160]} />
          <meshBasicMaterial
            ref={(m) => {
              if (m) mats.current[i] = m
            }}
            color={r.color}
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

/* ---------- Satellite on an orbit passing over India ---------- */
function Satellite({ fade }: { fade: MutableRefObject<number> }) {
  const sat = useRef<THREE.Group>(null)
  const R = 1.32
  const { a, b, line } = useMemo(() => {
    const a = latLonToVec3(INDIA.lat, INDIA.lon).normalize()
    const tilt = new THREE.Vector3(0.35, 1, 0.1).normalize()
    const b = new THREE.Vector3().crossVectors(a, tilt).normalize()
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 256; i++) {
      const t = (i / 256) * Math.PI * 2
      pts.push(a.clone().multiplyScalar(Math.cos(t) * R).add(b.clone().multiplyScalar(Math.sin(t) * R)))
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.22, depthWrite: false }),
    )
    return { a, b, line }
  }, [])
  useEffect(() => () => line.geometry.dispose(), [line])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.22 - 0.9
    const g = sat.current
    if (g) {
      tmp.copy(a).multiplyScalar(Math.cos(t) * R).addScaledVector(b, Math.sin(t) * R)
      g.position.copy(tmp)
      g.lookAt(0, 0, 0)
      g.visible = fade.current > 0.02
    }
    ;(line.material as THREE.LineBasicMaterial).opacity = 0.22 * fade.current
  })
  return (
    <>
      <primitive object={line} />
      <group ref={sat} scale={0.022}>
        <mesh>
          <boxGeometry args={[0.9, 0.9, 1.4]} />
          <meshBasicMaterial color="#c9d4de" />
        </mesh>
        <mesh position={[1.6, 0, 0]}>
          <boxGeometry args={[2.2, 0.05, 0.9]} />
          <meshBasicMaterial color="#3d5a73" />
        </mesh>
        <mesh position={[-1.6, 0, 0]}>
          <boxGeometry args={[2.2, 0.05, 0.9]} />
          <meshBasicMaterial color="#3d5a73" />
        </mesh>
        <mesh position={[0, 0, 0.85]}>
          <sphereGeometry args={[0.28, 12, 12]} />
          <meshBasicMaterial color={SIGNAL} toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

/* ---------- Scene ---------- */
export default function GlobeScene({ clusters, focusId, control, lite }: Props) {
  const globe = useRef<THREE.Group>(null)
  const { camera, size } = useThree()
  const focus = clusters.find((c) => c.id === focusId) ?? clusters[0]
  const indiaRot = useMemo(() => faceRotation(INDIA.lat, INDIA.lon), [])
  const focusRot = useMemo(() => faceRotation(focus.lat, focus.lon), [focus])
  const free = useRef({ yaw: indiaRot.yaw - 0.9, pitch: indiaRot.pitch * 0.6 })
  const no2Opacity = useRef(0.75)
  const rimStrength = useRef(1)
  const plumeScale = useRef(1)
  const ringReveal = useRef(0)
  const satFade = useRef(1)
  const smooth = useRef({ p: 0, mx: 0, my: 0 })
  const camPos = useMemo(() => new THREE.Vector3(), [])
  const target = useMemo(() => new THREE.Vector3(), [])
  const narrow = size.width < 768

  useFrame((_, dt) => {
    const c = control.current
    const s = smooth.current
    s.p += (c.progress - s.p) * Math.min(1, dt * 6)
    s.mx += (c.mouseX - s.mx) * Math.min(1, dt * 3)
    s.my += (c.mouseY - s.my) * Math.min(1, dt * 3)
    const p = s.p
    const d1 = easeInOut(span(p, 0.12, 0.32)) // overview -> India
    const d2 = easeInOut(span(p, 0.36, 0.54)) // India -> focus cluster

    // Free rotation: auto-rotate + drag, only meaningful in the hero.
    if (!c.dragging && d1 < 0.02) free.current.yaw += dt * 0.07
    free.current.yaw += c.dragYaw
    free.current.pitch = THREE.MathUtils.clamp(free.current.pitch + c.dragPitch, -0.9, 0.9)
    c.dragYaw = 0
    c.dragPitch = 0

    const fy = free.current.yaw
    const yawIndia = fy + wrapAngle(indiaRot.yaw - fy) * d1
    const pitchIndia = THREE.MathUtils.lerp(free.current.pitch, indiaRot.pitch, d1)
    const yaw = yawIndia + wrapAngle(focusRot.yaw - yawIndia) * d2
    const pitch = THREE.MathUtils.lerp(pitchIndia, focusRot.pitch, d2)
    const g = globe.current
    if (g) {
      g.rotation.set(pitch, yaw, 0, 'XYZ')
      const offX = narrow ? 0 : 1.45 * (1 - d1)
      const offY = narrow ? -0.55 * (1 - d1) : 0
      g.position.set(offX, offY, 0)
    }

    // Camera: hero -> India -> oblique close-up over the cluster (altitude ~0.075 ≈ 480 km).
    const d0 = narrow ? 4.9 : 4.3
    const dist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(d0, 2.05, d1), 1.085, d2)
    camPos.set(s.mx * 0.12 * (1 - d1), -s.my * 0.08 * (1 - d1) - 0.05 * d2, dist)
    target.set(0, 0, THREE.MathUtils.lerp(0, 1, d2))
    camera.position.copy(camPos)
    camera.lookAt(target)

    no2Opacity.current = 0.6 + 0.4 * d1
    rimStrength.current = 1 - 0.85 * d2
    plumeScale.current = THREE.MathUtils.lerp(1, 0.09, d2)
    ringReveal.current = span(p, 0.42, 0.6)
    satFade.current = 1 - d2
  })

  return (
    <group ref={globe}>
      <mesh renderOrder={0}>
        <sphereGeometry args={[0.996, 64, 64]} />
        <meshBasicMaterial color="#080b0f" />
      </mesh>
      <Dots lite={lite} />
      <No2Layer opacity={no2Opacity} />
      <Atmosphere strength={rimStrength} />
      <Plumes clusters={clusters} perCluster={lite ? 70 : 170} scale={plumeScale} />
      <Rings lat={focus.lat} lon={focus.lon} reveal={ringReveal} />
      <Satellite fade={satFade} />
    </group>
  )
}
