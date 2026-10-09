import { useEffect, useRef, type CSSProperties } from 'react'
import { ScrollTrigger } from '../lib/gsap'
import { prefersReducedMotion } from '../lib/motion'

// Blind-strip section transition: a band of horizontal strips of uneven thickness that grow, out
// of order, from hairlines into a solid block of the next section's colour as the band scrolls
// through the viewport (scrubbed). Like a scanner sweeping one section into the next.
const N = 14
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 91.7 + k * 17.3) * 43758.5453
  return x - Math.floor(x)
}
const BARS = Array.from({ length: N }, (_, i) => ({ h: 0.5 + rnd(i, 1) * 1.6, o: rnd(i, 2) }))

// reverse: starts solid and opens back into hairlines (leaving a dark section).
export default function Blinds({ className = '', reverse = false }: { className?: string; reverse?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const bars = Array.from(el.querySelectorAll<HTMLElement>('i'))
    const set = (p: number) =>
      bars.forEach((b, i) => {
        let k = Math.min(1, Math.max(0, (p - BARS[i].o * 0.45) / 0.4))
        if (reverse) k = 1 - k
        b.style.transform = `scaleY(${(0.035 + 0.965 * k * k * (3 - 2 * k)).toFixed(4)})`
      })
    if (prefersReducedMotion()) {
      set(1)
      return
    }
    const st = ScrollTrigger.create({ trigger: el, start: 'top 95%', end: 'bottom 35%', onUpdate: (s) => set(s.progress) })
    set(st.progress)
    return () => st.kill()
  }, [reverse])
  return (
    <div ref={ref} className={`blinds${reverse ? ' rev' : ''} ${className}`} aria-hidden="true">
      {BARS.map((b, i) => (
        <i key={i} style={{ '--h': b.h } as CSSProperties} />
      ))}
    </div>
  )
}
