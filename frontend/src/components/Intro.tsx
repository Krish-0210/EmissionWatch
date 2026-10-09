import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ClustersFile, SummaryFile } from '../api'
import { fmtInt } from '../lib/format'
import { setText } from '../lib/motion'
import type { GlobeControl } from '../three/GlobeScene'
import { heroGlobeScreen } from '../three/layout'
import '../styles/intro.css'

// "The eye opens" (docs/reference/analysis.md). ≤ 3.4 s, once per session, landing on Home only.
//   0.0–0.6  lids part          0.3–1.3  iris (orbit rings) draws in       0.8  pupil shows the Earth
//   0.9–2.5  satellite + scan sweep, counter 000→100, status lines from the real export
//   1.9–2.6  PANOPTICOAL assembles from the outer ring
//   2.6–3.4  pupil dilates past the screen; the globe camera pulls back out of it (control.intro 0→1)
// The iris sits exactly where the hero globe will be (three/layout.ts), so the hand-off has no cut.
// Click, any key or Skip jumps to the dilation. Reduced motion: a short fade.

const KEY = 'pc-intro'
let decided: boolean | undefined

/** True once per session, on a first load that lands on Home. Stable until the intro has run. */
export function shouldPlayIntro(): boolean {
  if (decided !== undefined) return decided
  try {
    decided = !sessionStorage.getItem(KEY) && window.location.pathname === '/'
    sessionStorage.setItem(KEY, '1')
  } catch {
    decided = false
  }
  return decided
}

const WORD = 'PANOPTICOAL'
const BUILD_MS = 2600
const DILATE_MS = 850

interface Props {
  control: MutableRefObject<GlobeControl>
  clusters?: ClustersFile
  summary?: SummaryFile
  reduced: boolean
  onDone: () => void
}

export default function Intro({ control, clusters, summary, reduced, onDone }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const counter = useRef<HTMLSpanElement>(null)
  const word = useRef<HTMLDivElement>(null)
  const [geo] = useState(() => {
    const w = window.innerWidth, h = window.innerHeight
    const g = heroGlobeScreen(w, h)
    // Iris radius: the globe's rim, capped so the whole eye (lids reach 1.58 R) stays on screen.
    const R = Math.min(g.r * 1.02, (w - g.cx - 12) / 1.6, (g.cx - 12) / 1.6)
    const rp = R * 0.3 // pupil radius
    const cover = Math.hypot(Math.max(g.cx, w - g.cx), Math.max(g.cy, h - g.cy)) + 40
    return { ...g, R, rp, scale: cover / rp, B: Math.max(w, h) * 1.6, w, h, narrow: w < 768 }
  })
  const done = useRef(false)

  // Letters fly in from points on the outer orbit ring.
  useLayoutEffect(() => {
    if (reduced) return
    const el = word.current
    if (!el) return
    const letters = Array.from(el.querySelectorAll<HTMLElement>('span'))
    letters.forEach((s, i) => {
      const r = s.getBoundingClientRect()
      const a = -Math.PI / 2 + (i / letters.length) * Math.PI * 2 * 0.85 - 0.6
      const fx = geo.cx + Math.cos(a) * geo.R, fy = geo.cy + Math.sin(a) * geo.R
      s.animate(
        [
          { transform: `translate(${fx - (r.left + r.width / 2)}px, ${fy - (r.top + r.height / 2)}px) scale(0.3)`, opacity: 0 },
          { opacity: 1, offset: 0.35 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 760, delay: 1900 + i * 42, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
      )
    })
  }, [geo, reduced])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const c = control.current
    let raf = 0
    const t0 = performance.now()
    let tFinish = 0

    const finish = (ms: number) => {
      if (done.current) return
      done.current = true
      el.classList.add('dilate')
      const ap = el.querySelector<HTMLElement>('.intro-aperture')
      const iris = el.querySelector<HTMLElement>('.intro-iris')
      const ease = 'cubic-bezier(0.65, 0, 0.35, 1)'
      ap?.animate([{ transform: 'scale(1)' }, { transform: `scale(${geo.scale})` }], { duration: ms, easing: ease, fill: 'forwards' })
      iris?.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${Math.min(geo.scale, 3.2)})`, opacity: 0 }], { duration: ms, easing: ease, fill: 'forwards' })
      tFinish = performance.now()
      const pull = () => {
        const k = Math.min(1, (performance.now() - tFinish) / (ms * 1.15))
        c.intro = k
        if (k < 1) raf = requestAnimationFrame(pull)
        else onDone()
      }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(pull)
    }

    if (reduced) {
      c.intro = 1
      el.classList.add('fade')
      const id = setTimeout(onDone, 450)
      return () => {
        clearTimeout(id)
        decided = false
      }
    }

    c.intro = 0
    // Counter 000 -> 100 between 0.9 s and 2.5 s.
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0 - 900) / 1600))
      setText(counter.current, String(Math.round(k * 100)).padStart(3, '0'))
      if (!done.current && k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const id = setTimeout(() => finish(DILATE_MS), BUILD_MS)
    const skip = () => finish(480)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') skip()
    }
    el.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', skip, { passive: true })
    return () => {
      clearTimeout(id)
      cancelAnimationFrame(raf)
      el.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', skip)
      c.intro = 1
      decided = false
    }
  }, [control, geo, reduced, onDone])

  const plants = clusters?.clusters.reduce((a, x) => a + x.n_plants, 0)
  const mw = clusters?.clusters.reduce((a, x) => a + x.capacity_mw, 0)
  const lines = [
    'Linking Sentinel-5P / TROPOMI',
    clusters ? `${clusters.clusters.length} clusters · ${plants} plants · ${fmtInt(mw ?? 0)} MW` : 'Loading cluster registry',
    summary ? `${fmtInt(summary.pooled_model.enhancement.n)} cluster-days analysed` : 'Loading daily model',
    clusters ? `Data as of ${clusters.as_of}` : 'Reading latest data',
  ]
  const { cx, cy, R, rp, B } = geo
  const textStyle: CSSProperties = geo.narrow
    ? { left: 16, right: 16, top: Math.max(64, cy - R * 0.62 - 250) }
    : { left: 'var(--gutter)', top: cy - 120, width: Math.max(280, cx - R - 80) }

  return createPortal(
    <div ref={root} className={`intro${reduced ? ' reduced' : ''}`} style={{ '--cx': `${cx}px`, '--cy': `${cy}px`, '--R': `${R}px` } as CSSProperties}>
      <div
        className="intro-aperture"
        aria-hidden="true"
        style={{ left: cx - rp - B, top: cy - rp - B, width: 2 * (rp + B), height: 2 * (rp + B), borderWidth: B }}
      />
      <div className="intro-cap" aria-hidden="true" style={{ left: cx - rp, top: cy - rp, width: 2 * rp, height: 2 * rp }} />
      <div className="intro-iris" aria-hidden="true" style={{ left: cx - R * 1.6, top: cy - R * 1.6, width: R * 3.2, height: R * 3.2 }}>
        <svg viewBox="-160 -160 320 320">
          <defs>
            <radialGradient id="intro-glow">
              <stop offset="0.25" stopColor="#7ce8d8" stopOpacity="0" />
              <stop offset="0.6" stopColor="#7ce8d8" stopOpacity="0.1" />
              <stop offset="1" stopColor="#7ce8d8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle r="120" fill="url(#intro-glow)" className="ii-glow" />
          {/* Lids */}
          <path d="M-158 0 C -96 -84, 96 -84, 158 0" className="ii-lid up" />
          <path d="M-158 0 C -96 84, 96 84, 158 0" className="ii-lid down" />
          {/* Iris: orbit rings (radius 100 = the globe's rim) */}
          <g className="ii-rings">
            <circle r="34" className="ii-ring r0" pathLength={1} />
            <g className="ii-spin a">
              <circle r="52" className="ii-ring r1 dash" pathLength={1} />
            </g>
            <g className="ii-spin b">
              <circle r="68" className="ii-ring r2" pathLength={1} />
              <circle r="68" className="ii-ticks" />
            </g>
            <g className="ii-spin c">
              <circle r="84" className="ii-ring r3 dash fine" pathLength={1} />
            </g>
            <circle r="100" className="ii-ring r4" pathLength={1} />
          </g>
          <g className="ii-scan">
            <path d="M0 0 L100 0 A100 100 0 0 0 86.6 -50 Z" className="ii-wedge" />
          </g>
          <g className="ii-orbit">
            <circle cx="0" cy="-100" r="4.2" className="ii-sat" />
            <circle cx="0" cy="-100" r="11" className="ii-sat-halo" />
          </g>
        </svg>
      </div>

      <div className="intro-text" style={textStyle} aria-hidden="true">
        <div ref={word} className="intro-word">
          {WORD.split('').map((ch, i) => (
            <span key={i} className={i >= 7 ? 'coal' : ''}>
              {ch}
            </span>
          ))}
        </div>
        <div className="intro-counter">
          <span className="micro">Acquiring signal</span>
          <span className="mono">
            <span ref={counter}>000</span>
            <small>%</small>
          </span>
        </div>
        <ol className="intro-lines">
          {lines.map((l, i) => (
            <li key={i} style={{ '--i': i } as CSSProperties}>
              <i />
              {l}
            </li>
          ))}
        </ol>
      </div>

      <button type="button" className="intro-skip" onClick={() => root.current?.dispatchEvent(new PointerEvent('pointerdown'))}>
        Skip intro <span aria-hidden="true">→</span>
      </button>
      <span className="sr-only" role="status">
        PanoptiCoal. Coal plants report their own pollution. We watch from space.
      </span>
    </div>,
    document.body,
  )
}
