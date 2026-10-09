import { useEffect, useRef, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { ClusterSummary } from '../api'
import { fmtInt, RISK_COLOR, RISK_LABEL } from '../lib/format'
import { gsap, ScrollTrigger } from '../lib/gsap'
import { useIsMobile, useReducedMotion } from '../lib/motion'
import { scrollVelocity, startVelocity } from '../lib/velocity'
import MaskLines from './MaskLines'

// Horizontal strip of the 11 clusters, ranked by audit risk. On desktop the section pins and the
// vertical scroll drives the strip sideways (cards lean with scroll speed), with a progress line
// and a counter; on phones and with reduced motion it is a native horizontal scroller.
export default function ClusterStrip({ clusters }: { clusters: ClusterSummary[] }) {
  const ranked = [...clusters].sort((a, b) => b.risk_score - a.risk_score)
  const sec = useRef<HTMLElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const leanEl = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const count = useRef<HTMLSpanElement>(null)
  const mobile = useIsMobile()
  const reduced = useReducedMotion()
  const pinned = !mobile && !reduced

  useEffect(() => {
    const s = sec.current, t = track.current
    if (!pinned || !s || !t) return
    const dist = () => Math.max(0, t.scrollWidth - window.innerWidth + 96)
    const n = t.children.length
    let last = -1
    const tw = gsap.to(t, {
      x: () => -dist(),
      ease: 'none',
      scrollTrigger: {
        trigger: s,
        start: 'top top',
        end: () => `+=${dist()}`,
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
        onUpdate: (st) => {
          if (bar.current) bar.current.style.transform = `scaleX(${st.progress.toFixed(4)})`
          const i = Math.min(n, 1 + Math.floor(st.progress * n * 0.999))
          if (i !== last && count.current) {
            last = i
            count.current.textContent = String(i).padStart(2, '0')
          }
        },
      },
    })
    // Cards lean with the scroll speed.
    const stop = startVelocity()
    const lean = () => {
      const l = leanEl.current
      if (!l) return
      const v = Math.max(-7, Math.min(7, scrollVelocity() * 0.3))
      l.style.transform = Math.abs(v) > 0.02 ? `skewX(${(-v).toFixed(2)}deg)` : ''
    }
    gsap.ticker.add(lean)
    requestAnimationFrame(() => ScrollTrigger.refresh())
    return () => {
      gsap.ticker.remove(lean)
      stop()
      tw.scrollTrigger?.kill()
      tw.kill()
      gsap.set(t, { clearProps: 'transform' })
    }
  }, [pinned, clusters.length])

  return (
    <section ref={sec} className={`cstrip${pinned ? ' pinned' : ''}`} aria-label="All clusters ranked by audit risk">
      <div className="container cs-head">
        <div>
          <div className="micro signal">Ranked by audit risk</div>
          <h2 className="display d-lg mask" style={{ marginTop: 14 }}>
            <MaskLines lines={[`${ranked.length} clusters,`, 'one score each.']} delay={80} />
          </h2>
        </div>
        <div className="cs-meter mono" aria-hidden="true">
          <span ref={count}>01</span> / {String(ranked.length).padStart(2, '0')}
          <span className="cs-bar">
            <span ref={bar} />
          </span>
        </div>
      </div>
      <div className="cs-viewport">
        <div ref={leanEl} className="cs-lean">
        <div ref={track} className="cs-track">
          {ranked.map((c, i) => (
            <Link key={c.id} to={`/cluster/${c.id}`} className="card cs-card tilt" data-tilt="3" data-cursor-label="Open" style={{ '--c': RISK_COLOR[c.risk_level] } as CSSProperties} viewTransition>
              <div className="cs-top">
                <span className="mono cs-rank">{String(i + 1).padStart(2, '0')}</span>
                <span className="badge">
                  <span className="dot" style={{ background: RISK_COLOR[c.risk_level], color: RISK_COLOR[c.risk_level] }} />
                  {RISK_LABEL[c.risk_level]}
                </span>
              </div>
              <div className="cs-score mono">
                {Math.round(c.risk_score)}
                <small>/100</small>
              </div>
              <h3 className="cs-name">{c.name}</h3>
              <div className="micro">
                {c.states.join(' · ')} · {c.n_plants} plants · {fmtInt(c.capacity_mw)} MW
              </div>
              <p className="muted small cs-line">{c.headline}</p>
              <div className="micro cs-conf">Confidence {c.confidence}</div>
            </Link>
          ))}
        </div>
        </div>
      </div>
    </section>
  )
}
