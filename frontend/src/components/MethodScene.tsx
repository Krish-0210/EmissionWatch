import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { MonthPoint } from '../api'
import { easeOut, setText, span } from '../lib/motion'
import { METHOD_AT, type RegisterDrive } from '../lib/story'

// One SVG scene that rebuilds the method as progress p (0..1) advances through six steps.
// Scale: 3 px per km around the cluster centre (400, 250).
// The markup is static; scroll writes attributes through refs (drive), so React never re-renders on scroll.
const CX = 400, CY = 250, KM = 3
const R = 120, LEN = 2 * Math.PI * R
const C10 = 2 * Math.PI * 10 * KM, C20 = 2 * Math.PI * 20 * KM

interface Props {
  register: RegisterDrive
  progress: MutableRefObject<number>
  residuals?: MonthPoint[]
  score?: number
  scoreColor?: string
  clusterName?: string
}

type Key =
  | 'recede' | 'bg' | 'eq' | 'ringFill' | 'r10' | 'r20' | 'l20' | 'l10' | 'plant'
  | 'wx' | 'season' | 'mix0' | 'mix1' | 'mix2' | 'res' | 'score' | 'scoreArc' | 'scoreNum'

export default function MethodScene({ register, progress, residuals, score = 0, scoreColor = '#ff5a3c', clusterName = '' }: Props) {
  const els = useRef<Partial<Record<Key, SVGElement | null>>>({})
  const bars = useRef<(SVGRectElement | null)[]>([])
  const bind = (k: Key) => (el: SVGElement | null) => void (els.current[k] = el)
  const res = useMemo(() => (residuals ?? []).filter((m) => m.residual != null), [residuals])

  useEffect(() => {
    const maxAbs = Math.max(1, ...res.map((m) => Math.abs(m.residual!)))
    const last = new Map<Element, string>()
    // Write an attribute only when its value changed.
    const set = (el: Element | null | undefined, attr: string, v: number | string) => {
      if (!el) return
      const s = typeof v === 'number' ? v.toFixed(3) : v
      if (last.get(el) === attr + s) return
      last.set(el, attr + s)
      el.setAttribute(attr, s)
    }
    const barKey = new Map<Element, string>()
    const apply = (p: number) => {
      const e = els.current
      const [kPlant, kRings, kBg, kWx, kRes, kScore] = METHOD_AT.map((a, i) => easeOut(span(p, a, (METHOD_AT[i + 1] ?? 0.97) - 0.02)))
      // Earlier layers recede once residuals and score take over.
      set(e.recede, 'opacity', 1 - 0.75 * span(p, METHOD_AT[4], METHOD_AT[4] + 0.08))
      set(e.bg, 'opacity', kBg)
      set(e.eq, 'opacity', span(p, METHOD_AT[2] + 0.06, METHOD_AT[3]))
      set(e.ringFill, 'opacity', kRings)
      set(e.r10, 'stroke-dashoffset', C10 * (1 - kRings))
      set(e.r20, 'stroke-dashoffset', C20 * (1 - span(kRings, 0.2, 1)))
      set(e.l20, 'opacity', kRings)
      set(e.l10, 'opacity', kRings)
      set(e.plant, 'opacity', kPlant)
      set(e.plant, 'transform', `translate(${CX} ${CY}) scale(${(0.6 + 0.4 * kPlant).toFixed(3)})`)
      set(e.wx, 'opacity', kWx)
      set(e.season, 'stroke-dashoffset', 200 * (1 - kWx))
      set(e.mix0, 'opacity', span(kWx, 0, 0.5))
      set(e.mix1, 'opacity', span(kWx, 0.2, 0.7))
      set(e.mix2, 'opacity', span(kWx, 0.4, 0.9))
      set(e.res, 'opacity', kRes * (1 - 0.7 * kScore))
      res.forEach((m, i) => {
        const el = bars.current[i]
        if (!el) return
        const h = (m.residual! / maxAbs) * 90 * span(kRes, (i / res.length) * 0.6, (i / res.length) * 0.6 + 0.4)
        const key = h.toFixed(2)
        if (barKey.get(el) === key) return
        barKey.set(el, key)
        el.setAttribute('y', (h > 0 ? -h : 0).toFixed(2))
        el.setAttribute('height', Math.abs(h).toFixed(2))
      })
      set(e.score, 'opacity', kScore)
      set(e.scoreArc, 'stroke-dashoffset', LEN * (1 - (score / 100) * kScore))
      const num = String(Math.round(score * kScore)).padStart(3, '0')
      setText(e.scoreNum, num)
    }
    apply(progress.current)
    return register(apply)
  }, [register, progress, res, score])

  return (
    <svg viewBox="0 0 800 500" className="method-scene" role="img" aria-label="Diagram of the method: plant cluster, 10 and 20 km rings, background annulus, weather and season, residuals, risk score">
      <defs>
        <radialGradient id="ms-plume" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff8a3d" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ff8a3d" stopOpacity="0" />
        </radialGradient>
        <pattern id="ms-dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1" fill="#7ce8d8" opacity="0.5" />
        </pattern>
        <mask id="ms-annulus">
          <circle cx={CX} cy={CY} r={80 * KM} fill="white" />
          <circle cx={CX} cy={CY} r={50 * KM} fill="black" />
        </mask>
        <marker id="ms-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#8a96a3" />
        </marker>
      </defs>

      <g ref={bind('recede')}>
        {/* 03 background annulus 50–80 km */}
        <g ref={bind('bg')} opacity="0">
          <rect x="0" y="0" width="800" height="500" fill="url(#ms-dots)" mask="url(#ms-annulus)" />
          <circle cx={CX} cy={CY} r={50 * KM} fill="none" stroke="#7ce8d8" strokeOpacity="0.5" strokeDasharray="3 5" />
          <circle cx={CX} cy={CY} r={80 * KM} fill="none" stroke="#7ce8d8" strokeOpacity="0.5" strokeDasharray="3 5" />
          <text x={CX + 80 * KM * 0.71 + 8} y={CY - 80 * KM * 0.71} className="ms-label">50–80 KM BACKGROUND</text>
          <text ref={bind('eq')} x={CX} y={CY + 80 * KM + 4} className="ms-label" textAnchor="middle" opacity="0">
            RING − BACKGROUND = ENHANCEMENT
          </text>
        </g>

        {/* 02 rings */}
        <circle ref={bind('ringFill')} cx={CX} cy={CY} r={20 * KM} fill="rgba(255,138,61,0.08)" opacity="0" />
        <circle ref={bind('r10')} cx={CX} cy={CY} r={10 * KM} fill="none" stroke="#7ce8d8" strokeWidth="1.5" transform={`rotate(-90 ${CX} ${CY})`} strokeDasharray={C10} strokeDashoffset={C10} />
        <circle ref={bind('r20')} cx={CX} cy={CY} r={20 * KM} fill="none" stroke="#7ce8d8" strokeWidth="1.5" transform={`rotate(-90 ${CX} ${CY})`} strokeDasharray={C20} strokeDashoffset={C20} />
        <text ref={bind('l20')} x={CX + 20 * KM + 8} y={CY + 4} className="ms-label" opacity="0">20 KM</text>
        <text ref={bind('l10')} x={CX + 10 * KM + 6} y={CY - 10 * KM + 2} className="ms-label" opacity="0">10 KM</text>

        {/* 01 plant + plume */}
        <g ref={bind('plant')} opacity="0" transform={`translate(${CX} ${CY}) scale(0.6)`}>
          <circle r="42" fill="url(#ms-plume)" className="ms-plume" />
          <rect x="-16" y="-2" width="32" height="14" rx="1" fill="#1c232b" stroke="#8a96a3" strokeWidth="0.8" />
          <rect x="-12" y="-20" width="5" height="20" fill="#1c232b" stroke="#8a96a3" strokeWidth="0.8" />
          <rect x="4" y="-26" width="5" height="26" fill="#1c232b" stroke="#8a96a3" strokeWidth="0.8" />
          <circle cx="6.5" cy="-32" r="4" fill="#ff8a3d" className="ms-puff" />
          <circle cx="-9.5" cy="-26" r="3" fill="#ff8a3d" className="ms-puff d2" />
        </g>

        {/* 04 weather + season */}
        <g ref={bind('wx')} opacity="0">
          {[90, 170, 330, 410].map((y, i) => (
            <line key={y} x1={40 + (i % 2) * 30} y1={y} x2={150 + (i % 2) * 30} y2={y - 14} className="ms-wind" markerEnd="url(#ms-arrow)" style={{ animationDelay: `${i * 0.4}s` }} />
          ))}
          <text x="40" y="60" className="ms-label">WIND · ERA5</text>
          <g transform="translate(600 410)">
            <text x="0" y="-34" className="ms-label">SEASON</text>
            <path ref={bind('season')} d={Array.from({ length: 41 }, (_, i) => `${i ? 'L' : 'M'}${i * 4},${-Math.sin((i / 40) * Math.PI * 2) * 16}`).join('')} fill="none" stroke="#8a96a3" strokeWidth="1.2" strokeDasharray="200" strokeDashoffset="200" />
          </g>
          <g transform="translate(620 80)">
            <text x="0" y="0" className="ms-label">MIXING LAYER</text>
            {(['mix0', 'mix1', 'mix2'] as const).map((k, i) => (
              <rect key={k} ref={bind(k)} x={i * 22} y={14} width="14" height={20 + i * 14} fill="none" stroke="#8a96a3" strokeWidth="1" opacity="0" />
            ))}
          </g>
        </g>
      </g>

      {/* 05 residuals: real monthly residuals of the focus cluster */}
      {res.length > 0 && (
        <g ref={bind('res')} opacity="0" transform="translate(80 250)">
          <text x="0" y="-110" className="ms-label">RESIDUAL · OBSERVED − EXPECTED · {clusterName.toUpperCase()} · MONTHLY</text>
          <line x1="0" x2="640" y1="0" y2="0" stroke="#2a333d" />
          {res.map((m, i) => (
            <rect
              key={m.month}
              ref={(el) => void (bars.current[i] = el)}
              x={(i / res.length) * 640}
              y={0}
              width={Math.max(1.5, 640 / res.length - 2)}
              height={0}
              fill={m.residual! > 0 ? '#ff8a3d' : '#7ce8d8'}
              opacity={0.85}
              rx="1"
            />
          ))}
        </g>
      )}

      {/* 06 score */}
      <g ref={bind('score')} opacity="0" transform={`translate(${CX} ${CY})`}>
        <circle r={R} fill="rgba(7,9,12,0.85)" stroke="#1c232b" strokeWidth="6" />
        <circle ref={bind('scoreArc')} r={R} fill="none" stroke={scoreColor} strokeWidth="6" strokeLinecap="round" transform="rotate(-90)" strokeDasharray={LEN} strokeDashoffset={LEN} />
        <text ref={bind('scoreNum')} y="12" textAnchor="middle" className="ms-score">000</text>
        <text y="44" textAnchor="middle" className="ms-label">{clusterName.toUpperCase()} · AUDIT RISK</text>
      </g>
    </svg>
  )
}
