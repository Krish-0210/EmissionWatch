// R3F idiom: three.js uniforms are mutated inside useFrame.
/* oxlint-disable react/immutability */
import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

const SIGNAL = new THREE.Color('#7ce8d8')
const EMBER = new THREE.Color('#ff8a3d')
const fract = (x: number) => x - Math.floor(x)
const hash = (i: number, k: number) => fract(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453)

// Scene units: 1 unit = 10 km. Rings at 10 km, 20 km; background annulus 50–80 km.
function Ring({ r, w = 0.035, opacity = 1 }: { r: number; w?: number; opacity?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r - w, r + w, 160]} />
      <meshBasicMaterial color={SIGNAL} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

const particleShader = {
  vertexShader: /* glsl */ `
    uniform float uTime; uniform float uPx;
    attribute float aSeed; attribute float aR; attribute float aA;
    varying float vA;
    void main() {
      float t = fract(uTime * (0.04 + 0.04 * fract(aSeed * 3.7)) + aSeed);
      float r = aR * (1.0 + 0.6 * t);
      vec3 p = vec3(cos(aA) * r, t * 2.2, sin(aA) * r);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uPx / -mv.z, 1.0, 10.0);
      vA = smoothstep(0.0, 0.1, t) * (1.0 - t);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(uColor * 1.4, smoothstep(0.5, 0.0, d) * vA * 0.8);
    }`,
}

function Particles({ count }: { count: number }) {
  const { gl } = useThree()
  const geo = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count), rr = new Float32Array(count), aa = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      seed[i] = hash(i, 1)
      // Gaussian-ish radius: most particles inside 20 km.
      rr[i] = Math.abs((hash(i, 2) + hash(i, 3) + hash(i, 4) - 1.5) * 1.6)
      aa[i] = hash(i, 5) * Math.PI * 2
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    g.setAttribute('aR', new THREE.BufferAttribute(rr, 1))
    g.setAttribute('aA', new THREE.BufferAttribute(aa, 1))
    return g
  }, [count])
  useEffect(() => () => geo.dispose(), [geo])
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPx: { value: 40 }, uColor: { value: EMBER } }), [])
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1)
    uniforms.uPx.value = 40 * gl.getPixelRatio()
  })
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={particleShader.vertexShader}
        fragmentShader={particleShader.fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function Scene({ count }: { count: number }) {
  const group = useRef<THREE.Group>(null)
  return (
    <group ref={group} rotation={[0.08, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[5, 8, 160]} />
        <meshBasicMaterial color={SIGNAL} transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Ring r={5} w={0.025} opacity={0.45} />
      <Ring r={8} w={0.025} opacity={0.45} />
      <Ring r={2} opacity={0.9} />
      <Ring r={1} opacity={1} />
      <gridHelper args={[18, 18, '#1c232b', '#141a21']} position={[0, -0.01, 0]} />
      <mesh position={[0, 0.06, 0]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshBasicMaterial color={EMBER} toneMapped={false} />
      </mesh>
      <Particles count={count} />
    </group>
  )
}

export default function RingsCanvas({ count, lite }: { count: number; lite: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [maxDpr] = useState(() => Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5))
  // Render only while on screen and the tab is visible.
  useEffect(() => {
    const el = host.current
    if (!el) return
    let onScreen = true
    const sync = () => setVisible(onScreen && document.visibilityState !== 'hidden')
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting
      sync()
    })
    io.observe(el)
    document.addEventListener('visibilitychange', sync)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return (
    <div ref={host} className="rings-host">
      <Canvas
        dpr={[1, maxDpr]}
        frameloop={visible ? 'always' : 'never'}
        camera={{ fov: 35, position: [0, 9.6, 18.6], near: 0.1, far: 100 }}
        gl={{ antialias: maxDpr <= 1, alpha: true, stencil: false }}
        onCreated={({ gl }) => {
          gl.debug.checkShaderErrors = import.meta.env.DEV
        }}
      >
        <Scene count={count} />
        <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} minPolarAngle={0.35} maxPolarAngle={1.35} />
      </Canvas>
    </div>
  )
}
