import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ClusterDetail, ModelStats, MonthPoint } from '../api'
import { briefAvailable, fetchCluster, fetchSummary, fetchTimeseries, generateBrief, peekCluster, peekSummary, peekTimeseries, type Brief } from '../api'
import { ConfidenceBadge, RiskBadge } from '../components/Badges'
import BigWord from '../components/BigWord'
import CountUp from '../components/CountUp'
import Icon from '../components/Icons'
import { InspectorScene } from '../components/Illustrations'
import Markdown from '../components/Markdown'
import { Ticker, type TickerItem } from '../components/PageHero'
import { fmt, fmtInt, fmtP, fmtPct, RISK_COLOR, RISK_LABEL } from '../lib/format'
import { prefersReducedMotion, useInView, useIsMobile, useReducedMotion } from '../lib/motion'
import { useBackdropTone } from '../lib/backdrop'
import { scrollToY } from '../lib/scroll'
import { useAsync } from '../lib/useAsync'
import { webglOk } from '../lib/webgl'
import './cluster.css'

const RingsCanvas = lazy(() => import('../three/RingsCanvas'))
const ClusterCharts = lazy(() => import('../components/ClusterCharts'))

function Gauge({ c }: { c: ClusterDetail }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const r = 84, len = 2 * Math.PI * r
  const color = RISK_COLOR[c.risk_level]
  return (
    <div className="gauge" ref={ref} role="img" aria-label={`Audit risk ${Math.round(c.risk_score)} out of 100, ${RISK_LABEL[c.risk_level]}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="96" className="gauge-ticks" />
        <circle cx="100" cy="100" r={r} fill="none" stroke="#1c232b" strokeWidth="6" />
        {[40, 65].map((t) => {
          const a = (t / 100) * 2 * Math.PI - Math.PI / 2
          return <line key={t} x1={100 + Math.cos(a) * 74} y1={100 + Math.sin(a) * 74} x2={100 + Math.cos(a) * 94} y2={100 + Math.sin(a) * 94} stroke="#5d6875" strokeWidth="1.5" />
        })}
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={inView ? len * (1 - c.risk_score / 100) : len}
          transform="rotate(-90 100 100)"
          className="gauge-arc"
          style={{ filter: `drop-shadow(0 0 ${c.risk_level === 'high' ? 10 : 5}px ${color})` }}
        />
        <g className="gauge-needle" style={{ '--a': `${inView ? (c.risk_score / 100) * 360 : 0}deg` } as CSSProperties}>
          <circle cx="100" cy={100 - r} r="5" fill={color} />
        </g>
      </svg>
      <div className="gauge-center">
        <div className="micro">Audit risk</div>
        <CountUp value={Math.round(c.risk_score)} pad={3} className="gauge-num" />
        <div className="micro">/ 100</div>
      </div>
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

// Hero visual: the cluster's 10/20 km rings and 50–80 km background in 3D, particle density from its
// mean NO2 enhancement, with the gauge in front.
function HeroStage({ c, months }: { c: ClusterDetail; months?: MonthPoint[] }) {
  const reduced = useReducedMotion()
  const mobile = useIsMobile()
  const obs = (months ?? []).map((m) => m.observed_no2).filter((x): x is number => x != null)
  const mean = obs.length ? obs.reduce((a, b) => a + b, 0) / obs.length : 0
  const count = Math.round(Math.min(3500, 120 + mean * 16) * (mobile ? 0.5 : 1))
  const gl = !reduced && webglOk()
  return (
    <div className="ch-stage">
      <div className="ch-rings">
        {gl ? <Suspense fallback={<RingsPoster />}>{months ? <RingsCanvas count={count} lite={mobile} /> : <RingsPoster />}</Suspense> : <RingsPoster />}
      </div>
      <div className="ch-gauge card">
        <Gauge c={c} />
      </div>
      <ul className="ring-key">
        <li>
          <i className="solid" /> 10 km
        </li>
        <li>
          <i className="solid" /> 20 km
        </li>
        <li>
          <i className="band" /> 50–80 km background
        </li>
        {obs.length > 0 && (
          <li className="micro">
            Particles ∝ mean NO₂ <span className="nocase">{fmt(mean)} µmol/m²</span> · {obs.length} months{gl ? ' · drag to rotate' : ''}
          </li>
        )}
      </ul>
    </div>
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
      icon: 'pulse' as const,
      title: 'Recent excess NO₂',
      score: s.persistent_excess.score,
      detail: `Over the last 90 days, NO₂ was ${fmt(Math.abs(s.persistent_excess.z))} standard deviations ${
        s.persistent_excess.z >= 0 ? 'above' : 'below'
      } what reported generation and weather predict, compared with this cluster’s own history.`,
    },
    {
      key: 'intensity_trend' as const,
      icon: 'chart' as const,
      title: 'Trend in NO₂ per unit of electricity',
      score: trend.score,
      detail: `${trend.pct_per_year >= 0 ? 'Rising' : 'Falling'} about ${fmt(Math.abs(trend.pct_per_year), 0)}% a year across ${
        trend.yearly.length
      } yearly estimates (t = ${fmt(trend.t, 2)}; |t| below 2 is not a clear trend).`,
    },
    {
      key: 'peer_intensity' as const,
      icon: 'layers' as const,
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
            <strong className="row" style={{ gap: 10 }}>
              <Icon name={r.icon} size={20} className="signal-ic" />
              {r.title}
            </strong>
            <span className="micro mono">
              {fmt(r.score, 0)} × {c.weights[r.key]} = <span className="text">{fmt(r.score * c.weights[r.key], 1)}</span>
            </span>
          </div>
          <div className="bar" role="img" aria-label={`${r.title}: ${Math.round(r.score)} out of 100`}>
            <div style={{ '--w-n': (r.score / 100).toFixed(3), transitionDelay: `${200 + i * 350}ms` } as CSSProperties} />
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
    <div className="card">
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

function YearlyBars({ c }: { c: ClusterDetail }) {
  const ys = c.signals.intensity_trend.yearly
  const max = Math.max(...ys.map((y) => Math.abs(y.coef) + y.se), 0.01)
  return (
    <div className="card">
      <div className="micro">Intensity by year</div>
      <h3>NO₂ per MU/day, each year</h3>
      <p className="small muted">The generation coefficient estimated separately for each year (± one standard error). The trend signal is the slope through these.</p>
      <div className="years">
        {ys.map((y, i) => (
          <div key={y.year} className="year" style={{ '--i': i } as CSSProperties}>
            <div className="year-col">
              <span className="year-se" style={{ bottom: `${50 + ((y.coef - y.se) / max) * 50}%`, height: `${((2 * y.se) / max) * 50}%` }} />
              <span className="year-dot" style={{ bottom: `${50 + (y.coef / max) * 50}%` }} title={`${y.year}: ${fmt(y.coef, 3)} ± ${fmt(y.se, 3)}, ${y.days} days`} />
            </div>
            <span className="micro mono">{String(y.year).slice(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Plants({ c }: { c: ClusterDetail }) {
  return (
    <div className="card">
      <div className="micro">Registry</div>
      <h3>Plants in this cluster</h3>
      <div className="plant-grid spot-group">
        {c.plants.map((p, i) => (
          <div key={p.id} className={`card plant-card tilt${p.status === 'operating' ? '' : ' retired'}`} style={{ '--i': i } as CSSProperties}>
            <Icon name="plant" size={26} className="plant-ic" />
            <div>
              <div className="plant-name">{p.name}</div>
              <div className="micro">
                {p.state} · {p.status === 'operating' ? 'Operating' : 'Retired'}
              </div>
            </div>
            <div className="plant-mw mono">
              {fmtInt(p.capacity_mw)}
              <span className="micro"> MW</span>
            </div>
          </div>
        ))}
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
    <div className="card">
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

// Reveals the brief like it is being typed (whole text for screen readers and reduced motion).
function Typed({ source }: { source: string }) {
  const [n, setN] = useState(() => (prefersReducedMotion() ? source.length : 0))
  useEffect(() => {
    if (prefersReducedMotion()) return
    let raf = 0
    const t0 = performance.now()
    const total = Math.min(2200, 400 + source.length * 1.2)
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / total)
      setN(Math.round(source.length * k))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [source])
  const done = n >= source.length
  return (
    <div className={`typed${done ? ' done' : ''}`}>
      <div className="sr-only">
        <Markdown source={source} />
      </div>
      <div aria-hidden="true">
        <Markdown source={source.slice(0, n)} />
      </div>
    </div>
  )
}

function BriefPanel({ c }: { c: ClusterDetail }) {
  const [state, setState] = useState<{ loading?: boolean; md?: string; source?: Brief['source']; error?: string; info?: string }>({})
  const run = async () => {
    if (!briefAvailable) {
      setState({ info: 'Brief generation is available in the deployed version (it calls the API). The numbers it would use are all on this page.' })
      return
    }
    setState({ loading: true })
    try {
      const b = await generateBrief(c.id)
      setState({ md: b.markdown, source: b.source })
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className="brief-wrap">
      <div className="brief-intro">
        <InspectorScene className="brief-il" />
        <div>
          <div className="micro">For inspectors</div>
          <h3>Inspection brief</h3>
          <p className="small muted">A short written brief for inspectors, generated only from this cluster’s numbers. Every number in it must appear on this page.</p>
          <button className={`pill magnetic${state.loading ? ' shimmer' : ''}`} onClick={run} disabled={state.loading} aria-busy={state.loading}>
            <Icon name="doc" size={18} draw={false} /> {state.loading ? 'Generating brief…' : 'Generate inspection brief'} <span className="arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <div aria-live="polite">
        {state.loading && (
          <div className="doc doc-loading" aria-hidden="true">
            <div className="brief-skeleton">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {state.info && <div className="alert">{state.info}</div>}
        {state.error && <div className="alert err">{state.error}</div>}
        {state.md && (
          <article className="doc">
            <header className="doc-head">
              <Icon name="doc" size={20} draw={false} />
              <span className="micro">
                Inspection brief · {c.name} · data as of {c.as_of}
              </span>
              <span className={`micro brief-source ${state.source}`}>{state.source === 'bedrock' ? 'Written by AI (Amazon Bedrock)' : 'Auto-generated brief'}</span>
            </header>
            <div className="doc-stamp" aria-hidden="true">
              Anomaly · not proof
            </div>
            <Typed source={state.md} />
          </article>
        )}
      </div>
    </div>
  )
}

const TABS = [
  { id: 'evidence', label: 'Evidence', icon: 'pulse' as const },
  { id: 'model', label: 'Model', icon: 'chart' as const },
  { id: 'plants', label: 'Plants', icon: 'plant' as const },
  { id: 'brief', label: 'Brief', icon: 'doc' as const },
]

function Tabs({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const list = useRef<HTMLDivElement>(null)
  const ind = useRef<HTMLSpanElement>(null)
  // Indicator slides to the active tab (transform only).
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)
    const i = ind.current
    if (!el || !i) return
    const place = () => {
      i.style.transform = `translateX(${el.offsetLeft}px) scaleX(${el.offsetWidth / 100})`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [tab])
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1
    if (next < 0) return
    e.preventDefault()
    setTab(TABS[next].id)
    list.current?.querySelector<HTMLElement>(`[data-tab="${TABS[next].id}"]`)?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label="Cluster details" ref={list} onKeyDown={onKey}>
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          id={`tab-${t.id}`}
          data-tab={t.id}
          aria-selected={tab === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          className={`tab ripple${tab === t.id ? ' on' : ''}`}
          onClick={() => setTab(t.id)}
        >
          <Icon name={t.icon} size={18} draw={false} />
          {t.label}
        </button>
      ))}
      <span className="tab-ind" ref={ind} aria-hidden="true" />
    </div>
  )
}

export default function ClusterPage() {
  const { id = '' } = useParams()
  const detail = useAsync(() => fetchCluster(id), [id], () => peekCluster(id))
  const ts = useAsync(() => fetchTimeseries(id), [id], () => peekTimeseries(id))
  const summary = useAsync(fetchSummary, [], peekSummary)
  const [tab, setTab] = useState('evidence')
  const c = detail.data
  const details = useRef<HTMLElement>(null)
  // Header actions: open a tab and bring the tab bar under the nav.
  const openTab = (t: string) => {
    setTab(t)
    const el = details.current
    if (el) scrollToY(el.getBoundingClientRect().top + window.scrollY - 96, 0.9)
  }
  const bt = summary.data?.backtest.find((r) => r.cluster === id)
  useBackdropTone('tone', c?.risk_level)

  const ticker: TickerItem[] = useMemo(() => {
    if (!c) return []
    const e = c.model.enhancement
    return [
      { label: 'Audit risk', value: `${Math.round(c.risk_score)}/100 · ${c.risk_level}`, color: RISK_COLOR[c.risk_level] },
      { label: 'Confidence', value: c.confidence },
      { label: 'Plants', value: `${c.n_plants} · ${fmtInt(c.capacity_mw)} MW` },
      { label: 'NO₂ per MU/day', value: `${fmt(e.coef, 3)} µmol/m² · t ${fmt(e.t, 1)}` },
      { label: 'Partial R²', value: fmt(e.partial_r2, 3) },
      { label: 'Days modelled', value: fmtInt(e.n) },
      { label: 'Valid satellite days, last 365', value: String(c.coverage.recent_valid_days) },
      ...(c.coverage.unreported_capacity_mw > 0 ? [{ label: 'Capacity not in CEA reports', value: `${fmtInt(c.coverage.unreported_capacity_mw)} MW`, color: '#ff8a3d' }] : []),
      ...(bt ? [{ label: 'Lockdown 2020 NO₂ vs 2019', value: `${fmtPct(bt.observed_change_pct)} observed · ${fmtPct(bt.predicted_change_pct)} predicted` }] : []),
      { label: 'Data as of', value: c.as_of },
    ]
  }, [c, bt])

  if (detail.error)
    return (
      <div className="container section">
        <div className="alert err">Could not load cluster “{id}”: {detail.error}</div>
        <p style={{ marginTop: 16 }}>
          <Link to="/map">Back to the map</Link>
        </p>
      </div>
    )
  if (!c) return <div className="container loading micro">Loading cluster…</div>

  return (
    <div className="cluster" style={{ '--risk': RISK_COLOR[c.risk_level] } as CSSProperties}>
      <header className="cluster-head" data-hold>
        <BigWord style={{ top: '0.02em', left: '-0.03em' }} speed={0.08}>
          {c.name}
        </BigWord>
        <div className="container layer cluster-head-grid">
          <div className="trig">
            <div className="crumb-row">
              <Link to="/map" className="back-link" viewTransition>
                <span aria-hidden="true">←</span> Back to the risk map
              </Link>
              <nav className="crumbs micro" aria-label="Breadcrumb">
                <ol>
                  <li>
                    <Link to="/" viewTransition>
                      Home
                    </Link>
                  </li>
                  <li>
                    <Link to="/map" viewTransition>
                      Risk map
                    </Link>
                  </li>
                  <li aria-current="page">{c.name}</li>
                </ol>
              </nav>
            </div>
            <p className="page-purpose">One cluster’s evidence: its audit risk score and why, satellite NO₂ against reported generation, its plants, and an inspection brief.</p>
            <div className="micro" style={{ marginTop: 22 }}>
              {c.states.join(' · ')} · {c.n_plants} operating plant{c.n_plants === 1 ? '' : 's'} · {fmtInt(c.capacity_mw)} MW · as of {c.as_of}
            </div>
            <h1 className="display d-lg ch-title" style={{ viewTransitionName: `ct-${c.id}` } as CSSProperties}>
              {c.name}
            </h1>
            <div className="row reveal" style={{ gap: 8, marginBottom: 20, '--d': '200ms' } as CSSProperties}>
              <RiskBadge level={c.risk_level} />
              <ConfidenceBadge confidence={c.confidence} />
            </div>
            <p className="lede reveal" style={{ '--d': '320ms' } as CSSProperties}>
              {c.headline}
            </p>
            <div className="row reveal" style={{ marginTop: 22, '--d': '420ms' } as CSSProperties}>
              <button type="button" className="pill magnetic" onClick={() => openTab('evidence')}>
                See the evidence <span className="arrow" aria-hidden="true">↓</span>
              </button>
              <button type="button" className="ulink" onClick={() => openTab('brief')}>
                Inspection brief &amp; RTI draft <span className="arrow" aria-hidden="true">→</span>
              </button>
            </div>
          </div>
          <div className="reveal" style={{ '--d': '150ms' } as CSSProperties}>
            <HeroStage c={c} months={ts.data?.months} />
          </div>
        </div>
        <Ticker items={ticker} seconds={56} />
      </header>

      <section className="container section-tight" ref={details}>
        <Tabs tab={tab} setTab={setTab} />
        <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={tab}>
          {tab === 'evidence' && (
            <div className="grid">
              <Signals c={c} />
              {ts.error && <div className="alert err">Could not load time series: {ts.error}</div>}
              {ts.data && (
                <Suspense fallback={<div className="loading micro">Loading charts…</div>}>
                  <ClusterCharts months={ts.data.months} />
                </Suspense>
              )}
            </div>
          )}
          {tab === 'model' && (
            <div className="grid">
              <ModelTable c={c} />
              <div className="grid grid-2">
                <YearlyBars c={c} />
                <ConfidenceCard c={c} />
              </div>
            </div>
          )}
          {tab === 'plants' && <Plants c={c} />}
          {tab === 'brief' && <BriefPanel c={c} />}
        </div>
        <p className="micro" style={{ marginTop: 32 }}>
          A high score marks an anomaly that warrants an audit, not proof of a violation · <Link to="/limits">Read the limits</Link>
        </p>
      </section>
    </div>
  )
}
