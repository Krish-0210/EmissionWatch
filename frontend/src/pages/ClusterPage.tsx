import { lazy, Suspense, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ClusterDetail, ModelStats, MonthPoint } from '../api'
import { briefAvailable, fetchCluster, fetchTimeseries, generateBrief } from '../api'
import { ConfidenceBadge, RiskBadge } from '../components/Badges'
import BigWord from '../components/BigWord'
import { GenerationChart, No2Chart } from '../components/ClusterCharts'
import CountUp from '../components/CountUp'
import Markdown from '../components/Markdown'
import { fmt, fmtInt, fmtP, RISK_COLOR } from '../lib/format'
import { useInView, useIsMobile, useReducedMotion } from '../lib/motion'
import { useAsync } from '../lib/useAsync'
import './cluster.css'

const RingsCanvas = lazy(() => import('../three/RingsCanvas'))

function Gauge({ c }: { c: ClusterDetail }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const r = 84, len = 2 * Math.PI * r
  const color = RISK_COLOR[c.risk_level]
  return (
    <div className="gauge" ref={ref}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={r} fill="none" stroke="#1c232b" strokeWidth="5" />
        {[40, 65].map((t) => {
          const a = (t / 100) * 2 * Math.PI - Math.PI / 2
          return <line key={t} x1={100 + Math.cos(a) * 76} y1={100 + Math.sin(a) * 76} x2={100 + Math.cos(a) * 92} y2={100 + Math.sin(a) * 92} stroke="#2a333d" strokeWidth="1.5" />
        })}
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={inView ? len * (1 - c.risk_score / 100) : len}
          transform="rotate(-90 100 100)"
          className="gauge-arc"
          style={{ filter: `drop-shadow(0 0 ${c.risk_level === 'high' ? 10 : 4}px ${color})` }}
        />
      </svg>
      <div className="gauge-center">
        <div className="micro">Audit risk</div>
        <CountUp value={Math.round(c.risk_score)} pad={3} className="gauge-num" />
        <div className="micro">/ 100</div>
      </div>
    </div>
  )
}

function MethodRings({ months }: { months?: MonthPoint[] }) {
  const reduced = useReducedMotion()
  const mobile = useIsMobile()
  const obs = (months ?? []).map((m) => m.observed_no2).filter((x): x is number => x != null)
  const mean = obs.length ? obs.reduce((a, b) => a + b, 0) / obs.length : 0
  const count = Math.round(Math.min(3500, 120 + mean * 16) * (mobile ? 0.5 : 1))
  return (
    <div className="card rings-card">
      <div className="micro">The method, in space</div>
      <h3>Rings around the cluster</h3>
      <div className="rings-stage">
        {reduced ? (
          <RingsPoster />
        ) : (
          <Suspense fallback={<RingsPoster />}>{months && <RingsCanvas count={count} lite={mobile} />}</Suspense>
        )}
      </div>
      <ul className="ring-key">
        <li><i className="solid" /> 10 km</li>
        <li><i className="solid" /> 20 km</li>
        <li><i className="band" /> 50–80 km background</li>
      </ul>
      <p className="muted small" style={{ marginTop: 10 }}>
        Particle density follows this cluster’s mean NO₂ enhancement:{' '}
        <span className="mono text">{fmt(mean)} µmol/m²</span> over {obs.length} months with valid data.{' '}
        {!reduced && <span className="micro">Drag to rotate</span>}
      </p>
    </div>
  )
}

function RingsPoster() {
  return (
    <svg viewBox="0 0 300 180" className="rings-poster" aria-hidden="true">
      <g transform="translate(150 95) scale(1 0.42)">
        <circle r="128" fill="none" stroke="rgba(124,232,216,0.08)" strokeWidth="48" />
        <circle r="104" fill="none" stroke="#7ce8d8" strokeOpacity="0.4" />
        <circle r="152" fill="none" stroke="#7ce8d8" strokeOpacity="0.4" />
        <circle r="40" fill="none" stroke="#7ce8d8" />
        <circle r="20" fill="none" stroke="#7ce8d8" />
      </g>
      <circle cx="150" cy="92" r="16" fill="#ff8a3d" opacity="0.35" />
      <circle cx="150" cy="95" r="3" fill="#ff8a3d" />
    </svg>
  )
}

function Signals({ c }: { c: ClusterDetail }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const s = c.signals
  const trend = s.intensity_trend
  const rows = [
    {
      key: 'persistent_excess' as const,
      title: 'Recent excess NO₂',
      score: s.persistent_excess.score,
      detail: `Over the last 90 days, NO₂ was ${fmt(Math.abs(s.persistent_excess.z))} standard deviations ${
        s.persistent_excess.z >= 0 ? 'above' : 'below'
      } what reported generation and weather predict, compared with this cluster’s own history.`,
    },
    {
      key: 'intensity_trend' as const,
      title: 'Trend in NO₂ per unit of electricity',
      score: trend.score,
      detail: `${trend.pct_per_year >= 0 ? 'Rising' : 'Falling'} about ${fmt(Math.abs(trend.pct_per_year), 0)}% a year across ${
        trend.yearly.length
      } yearly estimates (t = ${fmt(trend.t, 2)}; |t| below 2 is not a clear trend).`,
    },
    {
      key: 'peer_intensity' as const,
      title: 'Compared with other clusters',
      score: s.peer_intensity.score,
      detail: `NO₂ per unit generated is ${fmt(s.peer_intensity.ratio, 2)}× the median of the 11 clusters.`,
    },
  ]
  return (
    <div className={`card signals${inView ? ' in' : ''}`} ref={ref}>
      <div className="micro">Score breakdown</div>
      <h3>What drives the score</h3>
      {rows.map((r, i) => (
        <div className="signal" key={r.key}>
          <div className="row between">
            <strong>{r.title}</strong>
            <span className="micro mono">
              {fmt(r.score, 0)} × {c.weights[r.key]} = <span className="text">{fmt(r.score * c.weights[r.key], 1)}</span>
            </span>
          </div>
          <div className="bar" role="img" aria-label={`${r.title}: ${Math.round(r.score)} out of 100`}>
            <div style={{ '--w': `${r.score}%`, transitionDelay: `${200 + i * 350}ms` } as CSSProperties} />
          </div>
          <p className="small muted">{r.detail}</p>
        </div>
      ))}
      <p className="micro" style={{ marginTop: 6 }}>
        Score {fmt(c.risk_score, 1)} · below 40 low · below 65 medium · else high
      </p>
    </div>
  )
}

function ModelTable({ c }: { c: ClusterDetail }) {
  const rows: [string, ModelStats][] = [
    ['NO₂ enhancement (µmol/m² per MU/day)', c.model.enhancement],
    ['Ring / background ratio (per MU/day)', c.model.ratio],
  ]
  return (
    <div className="card reveal">
      <div className="micro">Model statistics</div>
      <h3>Daily regression</h3>
      <p className="small muted">
        NO₂ on reported generation, wind speed, boundary-layer height and season, with Newey–West standard errors. The
        coefficient is how much NO₂ rises per unit of daily generation.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Coef.</th>
              <th className="num">t</th>
              <th className="num">p</th>
              <th className="num">Partial R²</th>
              <th className="num">R²</th>
              <th className="num">Days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, m]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{m.coef.toPrecision(3)}</td>
                <td className="num">{fmt(m.t, 1)}</td>
                <td className="num">{fmtP(m.p)}</td>
                <td className="num">{fmt(m.partial_r2, 3)}</td>
                <td className="num">{fmt(m.r2, 2)}</td>
                <td className="num">{fmtInt(m.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Plants({ c }: { c: ClusterDetail }) {
  return (
    <div className="card reveal">
      <div className="micro">Registry</div>
      <h3>Plants in this cluster</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plant</th>
              <th>State</th>
              <th className="num">MW</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {c.plants.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted">{p.state}</td>
                <td className="num">{fmtInt(p.capacity_mw)}</td>
                <td className={p.status === 'operating' ? '' : 'muted'}>{p.status === 'operating' ? 'Operating' : 'Retired'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.coverage.unreported_capacity_mw > 0 && (
        <p className="small note-ember">
          {fmtInt(c.coverage.unreported_capacity_mw)} MW of the {fmtInt(c.coverage.ring_capacity_mw)} MW of coal capacity
          inside the 20 km ring is not in CEA generation reports: {c.coverage.unreported_plants.join('; ')}. The satellite
          sees their NO₂, but reported generation does not include them.
        </p>
      )}
    </div>
  )
}

function ConfidenceCard({ c }: { c: ClusterDetail }) {
  return (
    <div className="card reveal">
      <div className="micro">Confidence</div>
      <h3 style={{ textTransform: 'capitalize' }}>{c.confidence}</h3>
      <p className="small muted">
        Confidence starts high and drops one level for each issue: the generation effect is not statistically clear
        (enhancement p ≥ 0.01 or ratio p ≥ 0.05), generation explains under 1% of the remaining variation, fewer than
        120 valid satellite days in the last year, or more than 10% of the coal capacity in the ring is missing from CEA
        reports.
      </p>
      {c.confidence_notes.length ? (
        <>
          <div className="micro ember" style={{ marginBottom: 6 }}>
            Issues found
          </div>
          <ul className="small issues">
            {c.confidence_notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="small">
          <span className="micro signal">No issues found</span>
        </p>
      )}
      <p className="micro" style={{ marginBottom: 0 }}>
        {c.coverage.recent_valid_days} valid satellite days in the last 365
      </p>
    </div>
  )
}

function BriefPanel({ id }: { id: string }) {
  const [state, setState] = useState<{ loading?: boolean; md?: string; error?: string; info?: string }>({})
  const run = async () => {
    if (!briefAvailable) {
      setState({ info: 'Brief generation available in deployed version.' })
      return
    }
    setState({ loading: true })
    try {
      const b = await generateBrief(id)
      setState({ md: b.markdown })
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className="card brief-card reveal">
      <div className="micro">For inspectors</div>
      <h3>Inspection brief</h3>
      <p className="small muted">A short written brief for inspectors, generated from this cluster’s data.</p>
      <button className={`pill${state.loading ? ' shimmer' : ''}`} onClick={run} disabled={state.loading} aria-busy={state.loading}>
        {state.loading ? 'Generating brief…' : 'Generate inspection brief'} <span className="arrow" aria-hidden="true">→</span>
      </button>
      <div aria-live="polite" style={{ marginTop: 18 }}>
        {state.loading && (
          <div className="brief-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
        {state.info && <div className="alert">{state.info}</div>}
        {state.error && <div className="alert err">{state.error}</div>}
        {state.md && <Markdown source={state.md} />}
      </div>
    </div>
  )
}

export default function ClusterPage() {
  const { id = '' } = useParams()
  const detail = useAsync(() => fetchCluster(id), [id])
  const ts = useAsync(() => fetchTimeseries(id), [id])

  if (detail.error)
    return (
      <div className="container section">
        <div className="alert err">Could not load cluster “{id}”: {detail.error}</div>
        <p style={{ marginTop: 16 }}>
          <Link to="/map">Back to the map</Link>
        </p>
      </div>
    )
  const c = detail.data
  if (!c) return <div className="container loading micro">Loading cluster…</div>

  return (
    <div className="cluster">
      <header className="cluster-head">
        <BigWord style={{ top: '0.02em', left: '-0.03em' }} speed={0.08}>
          {c.name}
        </BigWord>
        <div className="container layer cluster-head-grid">
          <div>
            <Link to="/map" className="micro back">
              ← Risk map
            </Link>
            <div className="micro" style={{ marginTop: 28 }}>
              {c.states.join(' · ')} · {c.n_plants} operating plant{c.n_plants === 1 ? '' : 's'} · {fmtInt(c.capacity_mw)} MW · as of {c.as_of}
            </div>
            <h1 className="display d-lg" style={{ margin: '14px 0 18px' }}>
              {c.name}
            </h1>
            <div className="row" style={{ gap: 8, marginBottom: 20 }}>
              <RiskBadge level={c.risk_level} />
              <ConfidenceBadge confidence={c.confidence} />
            </div>
            <p className="lede">{c.headline}</p>
          </div>
          <Gauge c={c} />
        </div>
      </header>

      <section className="container section-tight">
        <div className="grid cluster-top">
          <MethodRings months={ts.data?.months} />
          <Signals c={c} />
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 24 }}>
        {ts.error && <div className="alert err">Could not load time series: {ts.error}</div>}
        {ts.data && (
          <div className="grid">
            <No2Chart months={ts.data.months} />
            <GenerationChart months={ts.data.months} />
          </div>
        )}
      </section>

      <section className="container section-tight">
        <div className="grid grid-2">
          <ConfidenceCard c={c} />
          <BriefPanel id={c.id} />
        </div>
        <div className="grid" style={{ marginTop: 16 }}>
          <ModelTable c={c} />
          <Plants c={c} />
        </div>
        <p className="micro" style={{ marginTop: 32 }}>
          A high score marks an anomaly that warrants an audit, not proof of a violation ·{' '}
          <Link to="/limits">Read the limits</Link>
        </p>
      </section>
    </div>
  )
}
