import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { memo, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ClusterSummary } from '../api'
import GlobeScene, { type GlobeControl } from './GlobeScene'

interface Props {
  clusters: ClusterSummary[]
  focusId: string
  control: MutableRefObject<GlobeControl>
  lite: boolean
  onReady?: () => void
}

// Canvas host: caps DPR, stops rendering when off-screen, handles drag + parallax.
function GlobeCanvas({ clusters, focusId, control, lite, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)

  // Pause the render loop while the canvas is scrolled out of view.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let last: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || control.current.progress > 0.1) return
      last = { x: e.clientX, y: e.clientY }
      control.current.dragging = true
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      control.current.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1
      control.current.mouseY = ((e.clientY - r.top) / r.height) * 2 - 1
      if (!last) return
      control.current.dragYaw += (e.clientX - last.x) * 0.005
      control.current.dragPitch += (e.clientY - last.y) * 0.004
      last = { x: e.clientX, y: e.clientY }
    }
    const up = () => {
      last = null
      control.current.dragging = false
      el.style.cursor = ''
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [control])

  return (
    <div ref={host} className="globe-host" aria-hidden="true">
      <Canvas
        dpr={[1, lite ? 1.25 : 1.5]}
        frameloop={visible ? 'always' : 'never'}
        camera={{ fov: 40, near: 0.001, far: 50, position: [0, 0, 3.5] }}
        gl={{ antialias: !lite, alpha: true, powerPreference: 'high-performance' }}
        onCreated={() => onReady?.()}
      >
        <GlobeScene clusters={clusters} focusId={focusId} control={control} lite={lite} />
        {!lite && (
          <EffectComposer multisampling={0}>
            <Bloom intensity={0.55} luminanceThreshold={0.62} luminanceSmoothing={0.2} mipmapBlur radius={0.6} />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  )
}

export default memo(GlobeCanvas)
