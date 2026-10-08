import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { ClusterSummary, MonthPoint, SummaryFile } from '../api'
import { CONF_LABEL, RISK_COLOR, RISK_LABEL } from '../lib/format'
import { easeOut, span } from '../lib/motion'
import { STEP_AT, STEPS, type RegisterDrive } from '../lib/story'
import CountUp from './CountUp'

// Generation and observed NO2, each indexed to its own mean = 100 so they share one axis.
// Line drawing is driven from scroll through refs (see HomeStory's drive), not props.
function IndexedChart({ months, gen, no2 }: { months: MonthPoint[]; gen: RefObject<SVGPathElement | null>; no2: RefObject<SVGPathElement | null> }) {
  const W = 520, H = 200, P = 8
  const mean = (k: 'generation_mu' | 'observed_no2') => {
    const v = months.map((m) => m[k]).filter((x): x is number => x != null)
    return v.reduce((a, b) => a + b, 0) / v.length
  }
  const gm = mean('generation_mu'), nm = mean('observed_no2')
  const max = 220
  const x = (i: number) => P + (i / (months.length - 1)) * (W - 2 * P)
  const y = (v: number) => H - P - (Math.min(v, max) / max) * (H - 2 * P)
  const path = (k: 'generation_mu' | 'observed_no2', m0: number) => {
    let d = ''
    let pen = false
    months.forEach((m, i) => {
      const v = m[k]
      if (v == null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y((v / m0) * 100).toFixed(1)}`
      pen = true
    })
    return d
  }
  const years = months.filter((m) => m.month.endsWith('-01'))
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="story-chart" role="img" aria-label="Monthly generation and observed NO2, indexed to their own means">
      <line x1={P} x2={W - P} y1={y(100)} y2={y(100)} stroke="#2a333d" strokeDasharray="2 4" />
      {years.map((m) => {
        const i = months.indexOf(m)
        return (
          <text key={m.month} x={x(i)} y={H + 14} className="axis">
            {m.month.slice(0, 4)}
          </text>
        )
      })}
      <path ref={gen} d={path('generation_mu', gm)} pathLength={1} className="line gen" style={{ strokeDashoffset: 1 }} />
      <path ref={no2} d={path('observed_no2', nm)} pathLength={1} className="line no2" style={{ strokeDashoffset: 1 }} />
    </svg>
  )
}

const RING_C = 2 * Math.PI * 70
const local = (p: number, i: number) => span(p, STEP_AT[i], STEP_AT[i + 1] ?? 1)
function ScoreRing({ color, arc }: { color: string; arc: RefObject<SVGCircleElement | null> }) {
  const r = 70, c = RING_C
  return (
    <svg viewBox="0 0 180 180" className="score-ring" aria-hidden="true">
      <circle cx="90" cy="90" r={r} fill="none" stroke="#1c232b" strokeWidth="6" />
      <circle
        cx="90"
        cy="90"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c}
        transform="rotate(-90 90 90)"
        ref={arc}
      />
    </svg>
  )
}

interface Props {
  register: RegisterDrive
  progress: MutableRefObject<{ progress: number }>
  step: number
  clusters: ClusterSummary[]
  focus: ClusterSummary
  summary?: SummaryFile
  months?: MonthPoint[]
}

export default function HomeStory({ register, progress, step, clusters, focus, summary, months }: Props) {
  const plants = clusters.reduce((a, c) => a + c.n_plants, 0)
  const mw = clusters.reduce((a, c) => a + c.capacity_mw, 0)
  const years = months?.length ? Number(months[months.length - 1].month.slice(0, 4)) - Number(months[0].month.slice(0, 4)) + 1 : 0
  const color = RISK_COLOR[focus.risk_level]
  const gen = useRef<SVGPathElement>(null)
  const no2 = useRef<SVGPathElement>(null)
  const arc = useRef<SVGCircleElement>(null)
  const score = focus.risk_score

  useEffect(() => {
    const apply = (p: number) => {
      const draw = easeOut(local(p, 2))
      gen.current?.style.setProperty('stroke-dashoffset', (1 - draw).toFixed(4))
      no2.current?.style.setProperty('stroke-dashoffset', (1 - span(draw, 0.15, 1)).toFixed(4))
      const k = easeOut(Math.min(1, local(p, 3) * 1.6)) * (score / 100)
      arc.current?.setAttribute('stroke-dashoffset', (RING_C * (1 - k)).toFixed(2))
    }
    apply(progress.current.progress)
    return register(apply)
  }, [register, progress, score, months])

  return (
    <div className="story" aria-live="polite">
      <div className="story-top container">
        <ol className="row story-chips" aria-label="Story steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={`chip ${i === step ? 'on' : i < step ? 'done' : ''}`}>
              {s.id} {s.label}
            </li>
          ))}
        </ol>
        <div className="micro story-count">
          <span className="text mono">{String(Math.max(0, step + 1)).padStart(2, '0')}</span> / 04
        </div>
      </div>

      <div className="container story-panels">
        <section className={`story-panel ${step === 0 ? 'on' : ''}`} aria-hidden={step !== 0}>
          <div className="micro signal">01 / The claim</div>
          <h2 className="display d-md">
            Plants report <span className="dim">their own output.</span>
          </h2>
          <p className="muted">
            Every day, each plant files how much electricity it generated with the Central Electricity Authority. Independent
            checks on the ground are rare and slow.
          </p>
          <div className="story-stats">
            <div>
              <CountUp value={plants} start={step >= 0} className="stat-num" />
              <div className="micro">operating plants</div>
            </div>
            <div>
              <CountUp value={mw} start={step >= 0} className="stat-num" />
              <div className="micro">MW capacity</div>
            </div>
          </div>
        </section>

        <section className={`story-panel ${step === 1 ? 'on' : ''}`} aria-hidden={step !== 1}>
          <div className="micro signal">02 / The observation</div>
          <h2 className="display d-md">
            Sentinel-5P <span className="dim">sees the NO₂.</span>
          </h2>
          <p className="muted">
            Around {focus.name}, we average NO₂ inside 20 km and subtract clean air 50–80 km out. What is left is the
            cluster’s own enhancement.
          </p>
          <ul className="ring-legend">
            <li><i className="solid" /> 10 km ring</li>
            <li><i className="solid" /> 20 km ring</li>
            <li><i className="band" /> 50–80 km background</li>
          </ul>
          {summary && (
            <div className="story-stats">
              <div>
                <CountUp value={summary.pooled_model.enhancement.n} start={step >= 1} className="stat-num" />
                <div className="micro">cluster-days analysed</div>
              </div>
            </div>
          )}
        </section>

        <section className={`story-panel wide ${step === 2 ? 'on' : ''}`} aria-hidden={step !== 2}>
          <div className="micro signal">03 / The comparison</div>
          <h2 className="display d-md">
            Output vs <span className="dim">what’s in the air.</span>
          </h2>
          <div className="row small" style={{ gap: 18, margin: '6px 0 4px' }}>
            <span className="key gen">Reported generation</span>
            <span className="key no2">Observed NO₂</span>
            <span className="micro">{focus.name} · monthly · index, mean = 100</span>
          </div>
          {months && <IndexedChart months={months} gen={gen} no2={no2} />}
          {years > 0 && (
            <div className="story-stats">
              <div>
                <CountUp value={years} start={step >= 2} className="stat-num" />
                <div className="micro">years of daily data</div>
              </div>
              <div>
                <CountUp value={clusters.length} start={step >= 2} className="stat-num" />
                <div className="micro">clusters</div>
              </div>
            </div>
          )}
        </section>

        <section className={`story-panel ${step === 3 ? 'on' : ''}`} aria-hidden={step !== 3}>
          <div className="micro signal">04 / The score</div>
          <div className="score-wrap">
            <ScoreRing color={color} arc={arc} />
            <div className="score-center">
              <CountUp value={Math.round(focus.risk_score)} start={step >= 3} pad={3} className="score-num" />
              <div className="micro">/ 100</div>
            </div>
          </div>
          <h2 className="display d-sm" style={{ marginTop: 12 }}>
            {focus.name}: <span style={{ color }}>{RISK_LABEL[focus.risk_level]}</span>
          </h2>
          <p className="muted small">
            {CONF_LABEL[focus.confidence]}. When NO₂ stays above what reported generation and weather explain, the
            Audit Risk Score rises. It flags an audit, not a verdict.
          </p>
        </section>
      </div>
    </div>
  )
}
