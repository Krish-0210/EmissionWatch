import { useEffect, useRef } from 'react'
import { gsap } from '../lib/gsap'
import { prefersReducedMotion } from '../lib/motion'
import { scrollVelocity, startVelocity } from '../lib/velocity'

// Giant uppercase marquee rows moving in opposite directions. Each row drifts slowly on its own,
// moves with the scroll (direction per row) and speeds up and leans (skew) with scroll velocity.
// Runs only while on screen; static with reduced motion.
export default function Marquee({ rows, label }: { rows: { words: string[]; outline?: boolean }[]; label: string }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el || prefersReducedMotion()) return
    const tracks = Array.from(el.querySelectorAll<HTMLElement>('.mq-track'))
    const off = tracks.map((_, i) => (i % 2 ? -0.25 : 0))
    let on = false
    const io = new IntersectionObserver(([e]) => (on = e.isIntersecting))
    io.observe(el)
    const stop = startVelocity()
    const tick = (_t: number, dt: number) => {
      if (!on) return
      const v = scrollVelocity()
      const skew = Math.max(-8, Math.min(8, v * 0.35))
      tracks.forEach((t, i) => {
        const dir = i % 2 ? 1 : -1
        // offset in copies (the track holds 4): slow drift + a boost from scroll speed
        off[i] += dir * (dt / 1000) * (0.018 + Math.min(0.25, Math.abs(v) * 0.004))
        const scrollPart = (dir * window.scrollY * 0.00022) % 1
        let f = (off[i] + scrollPart) % 1
        if (f > 0) f -= 1
        t.style.transform = `translate3d(${(f * 25).toFixed(3)}%, 0, 0) skewX(${(skew * -dir).toFixed(2)}deg)`
      })
    }
    gsap.ticker.add(tick)
    return () => {
      gsap.ticker.remove(tick)
      io.disconnect()
      stop()
    }
  }, [])
  return (
    <div ref={root} className="marquee" role="img" aria-label={label}>
      {rows.map((r, i) => (
        <div key={i} className={`mq-row${r.outline ? ' outline' : ''}`} aria-hidden="true">
          <div className="mq-track">
            {Array.from({ length: 4 }, (_, c) => (
              <span className="mq-copy" key={c}>
                {r.words.map((w) => (
                  <span key={w} className="mq-item">
                    {w}
                    <i className="mq-sep" />
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
