import { useEffect, useRef } from 'react'
import { useMediaQuery, useReducedMotion } from '../lib/motion'

// Subtle ring that trails the pointer; desktop (fine pointer) only.
export default function Cursor() {
  const fine = useMediaQuery('(pointer: fine) and (min-width: 768px)')
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!fine || reduced || !el) return
    let x = -100, y = -100, cx = -100, cy = -100, raf = 0
    const move = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      el.classList.add('on')
      const t = e.target as Element | null
      el.classList.toggle('hot', !!t?.closest('a, button, select, [role="button"], .leaflet-interactive'))
    }
    const leave = () => el.classList.remove('on')
    const tick = () => {
      cx += (x - cx) * 0.2
      cy += (y - cy) * 0.2
      el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
    }
  }, [fine, reduced])

  if (!fine || reduced) return null
  return <div ref={ref} className="cursor" aria-hidden="true" />
}
