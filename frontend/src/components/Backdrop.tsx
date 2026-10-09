import { memo, useEffect, useRef, type CSSProperties } from 'react'
import type { BackdropVariant } from '../lib/backdrop'
import { gsap } from '../lib/gsap'
import { prefersReducedMotion } from '../lib/motion'
import '../styles/backdrop.css'

// Layered page background, back to front: vertical gradient, three drifting radial glows (palette per
// page), two aurora bands, a measurement grid with "+" crosshairs and edge ruler (scroll parallax),
// dust, vignette. The film grain is body::after (index.css). CSS only, transforms/opacity animate;
// the grid offset is written from GSAP's ticker only when the scroll position changes.

// Deterministic dust: position, size, drift duration and delay.
const DUST = Array.from({ length: 18 }, (_, i) => {
  const r = (k: number) => {
    const x = Math.sin((i + 1) * 12.9898 * k + 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  return { x: r(1) * 100, y: r(2) * 100, s: 1 + r(3) * 1.8, t: 26 + r(4) * 30, d: -r(5) * 40, tone: i % 7 === 0 ? 'e' : i % 3 === 0 ? 's' : '' }
})

const GRID_REPEAT = 240 // px; the grid pattern (2 cells) repeats every 240 px, so the offset wraps

function Backdrop({ variant }: { variant: BackdropVariant }) {
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (prefersReducedMotion()) return
    let last = -1
    const tick = () => {
      const y = window.scrollY
      if (y === last || !grid.current) return
      last = y
      grid.current.style.transform = `translate3d(0, ${(-((y * 0.12) % GRID_REPEAT)).toFixed(1)}px, 0)`
    }
    gsap.ticker.add(tick)
    return () => gsap.ticker.remove(tick)
  }, [])
  return (
    <div className={`bd ${variant}`} aria-hidden="true">
      <i className="bd-glow g1" />
      <i className="bd-glow g2" />
      <i className="bd-glow g3" />
      <i className="bd-aurora a1" />
      <i className="bd-aurora a2" />
      <div className="bd-gridwrap">
        <div ref={grid} className="bd-grid" />
      </div>
      <div className="bd-dust">
        {DUST.map((d, i) => (
          <i key={i} className={d.tone} style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.s, height: d.s, '--t': `${d.t}s`, '--dl': `${d.d}s` } as CSSProperties} />
        ))}
      </div>
      <i className="bd-vignette" />
    </div>
  )
}

export default memo(Backdrop)
