import { useEffect, useRef } from 'react'
import { gsap } from '../lib/gsap'
import { useMediaQuery, useReducedMotion } from '../lib/motion'

const HOT = 'a, button, select, [role="button"], .leaflet-interactive'

// Ring that trails the pointer; fine pointer + desktop width only, off for reduced motion.
// No React state: pointermove stores the target, GSAP's ticker lerps and writes translate3d.
export default function Cursor() {
  const fine = useMediaQuery('(pointer: fine) and (min-width: 768px)')
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!fine || reduced || !el) return
    let x = -100, y = -100, cx = -100, cy = -100, moving = false
    let lastTarget: EventTarget | null = null
    const move = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      if (!moving) {
        moving = true
        el.classList.add('on')
      }
      if (e.target !== lastTarget) {
        lastTarget = e.target
        el.classList.toggle('hot', !!(e.target as Element | null)?.closest?.(HOT))
      }
    }
    const leave = () => {
      moving = false
      el.classList.remove('on')
    }
    const tick = (_t: number, dtMs: number) => {
      const dx = x - cx, dy = y - cy
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return
      // Lerp 0.18 per 60 Hz frame, frame-rate independent.
      const k = 1 - Math.pow(1 - 0.18, Math.min(dtMs, 50) / 16.67)
      cx += dx * k
      cy += dy * k
      el.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`
    }
    gsap.ticker.add(tick)
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      gsap.ticker.remove(tick)
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
    }
  }, [fine, reduced])

  if (!fine || reduced) return null
  return (
    <div ref={ref} className="cursor" aria-hidden="true">
      <i />
    </div>
  )
}
