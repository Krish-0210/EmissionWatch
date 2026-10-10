import { holdBusy } from '../lib/hold'
import { PerformanceMonitor } from '@react-three/drei'
import { advance, Canvas, useThree } from '@react-three/fiber'
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


// Renders from GSAP's ticker (the same loop that drives Lenis and ScrollTrigger), and only when
// the scene reports motion (auto-rotate, drag, scroll or parallax still settling), it is on
// screen, the tab is visible and the intro is not holding it. onFirstFrame fires after the first
// render (programs linked), which is when the intro starts its clock. Capped at ~60 fps: on 120/144 Hz
// screens a globe frame on every refresh left no GPU time for the page around it.
function Driver({ control, live, onFirstFrame }: { control: MutableRefObject<GlobeControl>; live: MutableRefObject<boolean>; onFirstFrame?: () => void }) {
  const get = useThree((s) => s.get)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const dirty = useRef(true)
  useEffect(() => {
    dirty.current = true
  }, [size, dpr])
  const first = useRef(onFirstFrame)
  useEffect(() => {
    let last = -1
    const tick = (time: number) => {
      const c = control.current
      if (!live.current || !(dirty.current || (c.active && !c.paused) || holdBusy())) return
      // gsap time is in seconds; 15 ms leaves headroom for 60 Hz frames that arrive slightly early
      if (time - last < 0.015) return
      last = time
      dirty.current = false
      advance(time, true, get())
      if (first.current) {
        const f = first.current
        first.current = undefined
        // One more frame for the GPU to finish, then report.
        requestAnimationFrame(() => requestAnimationFrame(f))
      }
    }
    gsap.ticker.add(tick)
    return () => gsap.ticker.remove(tick)
  }, [get, control, live])
  return null
}

// Canvas host: adaptive DPR, stops rendering when off-screen or hidden, handles drag + parallax.
function GlobeCanvas({ clusters, focusId, control, lite, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef(true)
  const maxDpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5)
  // Start one step below the cap; PerformanceMonitor raises it if frames stay fast.
  const [initialDpr] = useState(() => Math.max(1, maxDpr - 0.25))
  const [dpr, setDpr] = useState(initialDpr)
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

  // Plume tooltip: mouse hover, a tap (touch: tap again to open), or the hero's scan button. Click
  // (not drag) or a second tap opens the cluster page. The tip follows its pin on GSAP's ticker.
  const navigate = useNavigate()
  const tip = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<{ id: string; how: 'mouse' | 'tap' | 'scan' }>()
  const hovered = clusters.find((c) => c.id === shown?.id)
  useEffect(() => {
    const el = host.current
    if (!el) return
    let lastX = 0, lastY = 0, downX = 0, downY = 0, down = false, hot = -1
    let pinned: { idx: number; until: number; how: 'tap' | 'scan' } | null = null
    let cur = -1, curHow = ''
    let scanSeen = 0
    const hero = () => control.current.progress <= 0.1
    const pick = (x: number, y: number, r: number) => {
      const pins = control.current.pins ?? []
      let best = -1, bestD = r * r
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
    const sync = () => {
      const now = performance.now()
      const scan = control.current.scan
      if (scan && scan.t !== scanSeen) {
        scanSeen = scan.t
        pinned = { idx: scan.idx, until: scan.t + 4200, how: 'scan' }
      }
      if (pinned && (now > pinned.until || !hero())) pinned = null
      // A scan's tooltip appears once the beam has reached the ground.
      const pin = pinned && !(pinned.how === 'scan' && now - (control.current.scan?.t ?? 0) < 1300) ? pinned : null
      const i = hot >= 0 ? hot : pin ? pin.idx : -1
      const how = hot >= 0 ? 'mouse' : pin ? pin.how : ''
      const p = control.current.pins?.[i]
      const vis = i >= 0 && !!p && p.vis
      const idx = vis ? i : -1
      if (idx !== cur || how !== curHow) {
        cur = idx
        curHow = how
        control.current.hover = idx
        setShown(idx >= 0 ? { id: clusters[idx].id, how: how as 'mouse' | 'tap' | 'scan' } : undefined)
      }
      if (vis && tip.current) tip.current.style.transform = `translate3d(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px, 0)`
    }
    gsap.ticker.add(sync)
    const onDown = (e: PointerEvent) => {
      downX = e.clientX
      downY = e.clientY
      if (e.pointerType !== 'mouse' || !hero()) return
      down = true
      lastX = e.clientX
      lastY = e.clientY
      control.current.dragging = true
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      control.current.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1
      control.current.mouseY = ((e.clientY - r.top) / r.height) * 2 - 1
      if (e.pointerType === 'mouse' && hero()) {
        hot = down ? -1 : pick(e.clientX - r.left, e.clientY - r.top, 24)
        if (!down) el.style.cursor = hot >= 0 ? 'pointer' : ''
      } else hot = -1
      if (!down) return
      control.current.dragYaw += (e.clientX - lastX) * 0.005
      control.current.dragPitch += (e.clientY - lastY) * 0.004
      lastX = e.clientX
      lastY = e.clientY
    }
    const onUp = (e: PointerEvent) => {
      const still = Math.hypot(e.clientX - downX, e.clientY - downY) < 8
      const r = el.getBoundingClientRect()
      if (e.pointerType !== 'mouse') {
        // Touch / pen tap: the first tap shows the tooltip, a second tap on the same plume opens it.
        if (!still || !hero() || e.type === 'pointercancel') return
        const i = pick(e.clientX - r.left, e.clientY - r.top, 34)
        if (i >= 0 && pinned?.idx === i && pinned.how === 'tap') navigate(`/cluster/${clusters[i].id}`, { viewTransition: true })
        else pinned = i >= 0 ? { idx: i, until: performance.now() + 5000, how: 'tap' } : null
        return
      }
      const click = down && still
      down = false
      control.current.dragging = false
      el.style.cursor = ''
      if (click) {
        const i = pick(e.clientX - r.left, e.clientY - r.top, 24)
        if (i >= 0) navigate(`/cluster/${clusters[i].id}`, { viewTransition: true })
      }
    }
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') hot = -1
    }
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      gsap.ticker.remove(sync)
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
        }}
      >
        <PerformanceMonitor
          // Decide every ~1.5 s; renders are capped at 60 fps, so step up only when pinned at the cap.
          iterations={6}
          bounds={() => [50, 58]}
          flipflops={4}
          // No bloom pass: on an integrated GPU it halved the frame rate and its shader compile was a
          // long frame; the scene's additive Halo sprite gives the glow instead.
          onIncline={() => {
            if (dpr < ceiling.current) setDpr(Math.min(ceiling.current, dpr + 0.25))
          }}
          onDecline={() => {
            if (dpr > 1) {
              // Never climb back to a level that was too slow (no flip-flopping).
              ceiling.current = dpr - 0.25
              setDpr(dpr - 0.25)
            }
          }}
        >
          <Driver control={control} live={live} onFirstFrame={onReady} />
          <GlobeScene clusters={clusters} focusId={focusId} control={control} lite={lite} glow />
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
            <div className="micro">{shown?.how === 'tap' ? 'Tap again to open' : shown?.how === 'scan' ? 'Scanned · click to open' : 'Click to open'}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(GlobeCanvas)
