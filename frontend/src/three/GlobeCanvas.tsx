import { PerformanceMonitor } from '@react-three/drei'
import { advance, Canvas, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { memo, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { RISK_COLOR, RISK_LABEL } from '../lib/format'
import { gsap } from '../lib/gsap'
import type { ClusterSummary } from '../api'
import GlobeScene, { type GlobeControl } from './GlobeScene'

interface Props {
  clusters: ClusterSummary[]
  focusId: string
  control: MutableRefObject<GlobeControl>
  lite: boolean
  onReady?: () => void
}

// Few cores or little memory: never try bloom.
const lowEnd = () => (navigator.hardwareConcurrency || 8) <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4

// Renders from GSAP's ticker (the same loop that drives Lenis and ScrollTrigger), and only when
// the scene reports motion (auto-rotate, drag, scroll or parallax still settling), it is on
// screen and the tab is visible.
function Driver({ control, live }: { control: MutableRefObject<GlobeControl>; live: MutableRefObject<boolean> }) {
  const get = useThree((s) => s.get)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const dirty = useRef(true)
  useEffect(() => {
    dirty.current = true
  }, [size, dpr])
  useEffect(() => {
    const tick = (time: number) => {
      if (!live.current || !(dirty.current || control.current.active)) return
      dirty.current = false
      advance(time, true, get())
    }
    gsap.ticker.add(tick)
    return () => gsap.ticker.remove(tick)
  }, [get, control, live])
  return null
}

// Canvas host: adaptive DPR and bloom, stops rendering when off-screen or hidden, handles drag + parallax.
function GlobeCanvas({ clusters, focusId, control, lite, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef(true)
  const maxDpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5)
  // Start one step below the cap; PerformanceMonitor raises it if frames stay fast.
  const [initialDpr] = useState(() => Math.max(1, maxDpr - 0.25))
  const [dpr, setDpr] = useState(initialDpr)
  // Bloom: desktop only, switched on once the frame rate proves steady, off for good if it drops.
  const [bloom, setBloom] = useState(false)
  const bloomTried = useRef(lite || lowEnd())
  const ceiling = useRef(maxDpr)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let onScreen = true
    const sync = () => {
      live.current = onScreen && document.visibilityState !== 'hidden'
    }
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

  // Hover a plume: tooltip with name, risk and score; click (not drag) opens the cluster page.
  const navigate = useNavigate()
  const tip = useRef<HTMLDivElement>(null)
  const [hoverId, setHoverId] = useState<string>()
  const hovered = clusters.find((c) => c.id === hoverId)
  useEffect(() => {
    const el = host.current
    if (!el) return
    let lastX = 0, lastY = 0, downX = 0, downY = 0, down = false, hot = -1
    const pick = (x: number, y: number) => {
      const pins = control.current.pins ?? []
      let best = -1, bestD = 24 * 24
      pins.forEach((p, i) => {
        if (!p.vis) return
        const d = (p.x - x) ** 2 + (p.y - y) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      return best
    }
    const setHot = (i: number) => {
      if (i !== hot) {
        hot = i
        control.current.hover = i
        setHoverId(i >= 0 ? clusters[i].id : undefined)
        if (!down) el.style.cursor = i >= 0 ? 'pointer' : ''
      }
      const p = control.current.pins?.[i]
      if (i >= 0 && p && tip.current) tip.current.style.transform = `translate3d(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px, 0)`
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || control.current.progress > 0.1) return
      down = true
      lastX = downX = e.clientX
      lastY = downY = e.clientY
      control.current.dragging = true
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      control.current.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1
      control.current.mouseY = ((e.clientY - r.top) / r.height) * 2 - 1
      if (e.pointerType === 'mouse' && control.current.progress <= 0.1) setHot(down ? -1 : pick(e.clientX - r.left, e.clientY - r.top))
      else setHot(-1)
      if (!down) return
      control.current.dragYaw += (e.clientX - lastX) * 0.005
      control.current.dragPitch += (e.clientY - lastY) * 0.004
      lastX = e.clientX
      lastY = e.clientY
    }
    const onUp = (e: PointerEvent) => {
      const click = down && Math.hypot(e.clientX - downX, e.clientY - downY) < 6
      down = false
      control.current.dragging = false
      el.style.cursor = ''
      if (click) {
        const r = el.getBoundingClientRect()
        const i = pick(e.clientX - r.left, e.clientY - r.top)
        if (i >= 0) navigate(`/cluster/${clusters[i].id}`, { viewTransition: true })
      }
    }
    const onLeave = () => setHot(-1)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [control, clusters, navigate])

  return (
    <div ref={host} className="globe-host" aria-hidden="true">
      <Canvas
        dpr={dpr}
        frameloop="never"
        camera={{ fov: 40, near: 0.001, far: 50, position: [0, 0, 3.5] }}
        gl={{ antialias: initialDpr <= 1 && !lite, alpha: true, powerPreference: 'high-performance', stencil: false }}
        onCreated={({ gl }) => {
          // Shader error checks force a synchronous GPU round-trip per program; dev only.
          gl.debug.checkShaderErrors = import.meta.env.DEV
          onReady?.()
        }}
      >
        <PerformanceMonitor
          // Decide every ~1.5 s. On 60 Hz screens step up only when pinned at vsync; on high-refresh
          // screens keep at least 60 fps.
          iterations={6}
          bounds={(refresh) => (refresh > 100 ? [60, 90] : [50, 58])}
          flipflops={4}
          onIncline={(api) => {
            if (dpr < ceiling.current) setDpr(Math.min(ceiling.current, dpr + 0.25))
            // Bloom roughly halved the frame rate on an integrated GPU: try it only on ~60 Hz screens
            // already pinned at vsync (a later decline turns it off for good).
            else if (!bloomTried.current && api.refreshrate <= 100 && api.fps >= 0.95 * api.refreshrate) {
              bloomTried.current = true
              setBloom(true)
            }
          }}
          onDecline={() => {
            if (bloom) setBloom(false)
            else if (dpr > 1) {
              // Never climb back to a level that was too slow (no flip-flopping).
              ceiling.current = dpr - 0.25
              setDpr(dpr - 0.25)
            }
          }}
        >
          <Driver control={control} live={live} />
          <GlobeScene clusters={clusters} focusId={focusId} control={control} lite={lite} glow={!bloom} />
          {bloom && (
            <EffectComposer multisampling={0}>
              <Bloom intensity={0.55} luminanceThreshold={0.62} luminanceSmoothing={0.2} mipmapBlur radius={0.6} />
            </EffectComposer>
          )}
        </PerformanceMonitor>
      </Canvas>
      <div ref={tip} className={`globe-tip${hovered ? ' on' : ''}`} role="tooltip">
        {hovered && (
          <div className="globe-tip-box" style={{ '--c': RISK_COLOR[hovered.risk_level] } as React.CSSProperties}>
            <div className="globe-tip-name">{hovered.name}</div>
            <div className="globe-tip-row">
              <i />
              {RISK_LABEL[hovered.risk_level]} · <b className="mono">{Math.round(hovered.risk_score)}</b>/100
            </div>
            <div className="micro">Click to open</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(GlobeCanvas)
