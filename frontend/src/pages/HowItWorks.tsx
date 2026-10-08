import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BacktestRow, SummaryFile } from '../api'
import { fetchClusters, fetchSummary, fetchTimeseries } from '../api'
import BigWord from '../components/BigWord'
import CountUp from '../components/CountUp'
import MethodScene from '../components/MethodScene'
import { fmt, fmtP, fmtPct, RISK_COLOR } from '../lib/format'
import { ScrollTrigger } from '../lib/gsap'
import { setText, useInView, useReducedMotion } from '../lib/motion'
import { METHOD_AT, type RegisterDrive } from '../lib/story'
import { useAsync } from '../lib/useAsync'
import './howitworks.css'

const NO2 = '#ff8a3d'
const PREDICTED = '#7ce8d8'
const AXIS = { fontSize: 11, fill: '#8a96a3', fontFamily: 'JetBrains Mono, monospace' }

const STEPS = [
  {
    chip: 'Plant',
    title: 'Group plants into clusters',
    body: [
      'Satellite pixels are about 5 km across, so nearby plants blur together. We group 33 plants into 11 clusters whose centres are at least 100 km apart.',
      'We download about 2,800 daily generation reports (CEA, via the National Power Portal) from January 2019 and add up each cluster’s output per day.',
    ],
  },
  {
    chip: 'Rings',
    title: 'Measure NO₂ from space',
    body: ['Sentinel-5P measures nitrogen dioxide daily. For each cluster we take the average within 20 km. Cloudy days are dropped.'],
  },
  {
    chip: 'Background',
    title: 'Subtract the background',
    body: ['We subtract the background 50–80 km away, leaving the local enhancement: the NO₂ the cluster itself adds.'],
  },
  {
    chip: 'Weather',
    title: 'Account for weather and season',
    body: ['Wind spreads NO₂ out and a deeper mixing layer dilutes it. We add ERA5 wind speed and boundary-layer height for each day, plus a seasonal cycle.'],
  },
  {
    chip: 'Residuals',
    title: 'Predict, then compare',
    body: ['A regression predicts each day’s NO₂ from reported generation, weather and season. The gap between observed and predicted is the residual.'],
  },
  {
    chip: 'Score',
    title: 'Score sustained patterns',
    body: [
      'The Audit Risk Score combines three signals: how far the last 90 days of residuals sit above the cluster’s own history (50%), the trend in NO₂ per unit of electricity (25%), and NO₂ per unit compared with other clusters (25%).',
    ],
  },
]

const SOURCES = [
  ['Central Electricity Authority (CEA)', 'Daily generation report (DGR) per plant and unit'],
  ['National Power Portal', 'Public archive of the CEA daily reports'],
  ['ESA Sentinel-5P TROPOMI', 'Daily tropospheric NO₂ column'],
  ['Google Earth Engine', 'Satellite and weather data processing'],
  ['ECMWF ERA5', 'Hourly wind and boundary-layer height'],
  ['Global Energy Monitor', 'Plant locations and capacity, including plants not in CEA reports'],
]

function BacktestChart({ rows, names }: { rows: BacktestRow[]; names: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null)
  const show = useInView(ref)
  const reduced = useReducedMotion()
  const data = rows
    .filter((r) => r.cluster !== 'POOLED')
    .map((r) => ({ ...r, name: names[r.cluster] ?? r.cluster }))
    .sort((a, b) => a.observed_change_pct - b.observed_change_pct)
  return (
    <div className="card reveal" ref={ref}>
      <div className="micro">Backtest · Apr–May 2020 vs Apr–May 2019</div>
      <h3>2020 lockdown: NO₂ change, observed vs predicted</h3>
      <p className="muted small">
        The model was refitted without Mar–Jun 2020 and asked to predict the lockdown from reported generation and
        weather alone.
      </p>
      <div className="chart-legend">
        <span>
          <i className="sq" style={{ background: NO2 }} />
          Observed
        </span>
        <span>
          <i className="sq" style={{ background: PREDICTED }} />
          Predicted
        </span>
      </div>
      <div style={{ height: 360, margin: '0 -6px' }}>
        {show && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 44 }} barGap={2}>
              <CartesianGrid stroke="#1c232b" vertical={false} />
              <XAxis dataKey="name" tick={AXIS} interval={0} angle={-35} textAnchor="end" stroke="#1c232b" />
              <YAxis tick={AXIS} width={44} tickFormatter={(v: number) => `${v}%`} stroke="#1c232b" />
              <ReferenceLine y={0} stroke="#2a333d" />
              <Tooltip
                contentStyle={{ background: '#0e1217', border: '1px solid #2a333d', borderRadius: 10, fontSize: 13 }}
                labelStyle={{ color: '#8a96a3' }}
                itemStyle={{ color: '#e8edf2' }}
                formatter={(v, n) => [fmtPct(v as number), n]}
                cursor={{ fill: 'rgba(124,232,216,0.05)' }}
              />
              <Bar dataKey="observed_change_pct" name="Observed" fill={NO2} radius={[2, 2, 2, 2]} isAnimationActive={!reduced} animationDuration={1200} />
              <Bar dataKey="predicted_change_pct" name="Predicted" fill={PREDICTED} radius={[2, 2, 2, 2]} isAnimationActive={!reduced} animationDuration={1200} animationBegin={250} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function Results({ s, names }: { s: SummaryFile; names: Record<string, string> }) {
  const pooled = s.pooled_model.enhancement
  const bt = s.backtest
  const pooledBt = bt.find((r) => r.cluster === 'POOLED')
  const over = bt.filter((r) => r.cluster !== 'POOLED' && r.error > 0).length
  const coefs = [...s.clusters].sort((a, b) => b.generation_coef - a.generation_coef)
  return (
    <>
      <div className="micro signal reveal">Results</div>
      <h2 className="display d-lg reveal" style={{ '--d': '80ms', margin: '14px 0 36px' } as CSSProperties}>
        What the data <span className="dim">shows.</span>
      </h2>
      <div className="results-stats reveal">
        <div>
          <CountUp value={pooled.coef} decimals={2} className="big" />
          <div className="micro">
            <span className="nocase">µmol/m²</span> NO₂ per MU/day
          </div>
        </div>
        <div>
          <CountUp value={pooled.t} decimals={1} className="big" />
          <div className="micro">t-statistic</div>
        </div>
        <div>
          <CountUp value={pooled.n} className="big" />
          <div className="micro">cluster-days</div>
        </div>
        <div>
          <CountUp value={pooled.partial_r2} decimals={3} className="big" />
          <div className="micro">partial R²</div>
        </div>
      </div>
      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card reveal">
          <div className="micro">Pooled model</div>
          <h3>Generation shows up in the satellite data</h3>
          <p className="muted">
            Across all clusters (pooled model with cluster effects), each extra MU of daily generation adds{' '}
            <span className="text">{fmt(pooled.coef, 2)} µmol/m²</span> of NO₂ (t = {fmt(pooled.t, 1)}, p {fmtP(pooled.p)},{' '}
            {pooled.n.toLocaleString('en-IN')} cluster-days). The effect is statistically clear, but generation explains
            only a small share of day-to-day variation (partial R² = {fmt(pooled.partial_r2, 3)}); weather and season
            explain far more.
          </p>
        </div>
        <div className="card reveal findings" style={{ '--d': '120ms' } as CSSProperties}>
          <div className="micro ember">Findings</div>
          <ol>
            {s.findings.map((f, i) => (
              <li key={f}>
                <span className="mono micro">0{i + 1}</span>
                <span>{f}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <BacktestChart rows={bt} names={names} />
      </div>
      {pooledBt && (
        <p className="small muted reveal" style={{ marginTop: 14, maxWidth: '80ch' }}>
          Pooled across clusters, the model predicted {fmt(pooledBt.predicted_2020)} µmol/m² for Apr–May 2020; the
          satellite observed {fmt(pooledBt.observed_2020)} (2019: {fmt(pooledBt.observed_2019)}). The model over-predicted
          in {over} of {bt.length - 1} clusters: it has no term for traffic, industry and other non-power sources that
          also fell during the lockdown.
        </p>
      )}

      <div className="card reveal" style={{ marginTop: 16 }}>
        <div className="micro">Daily model, per cluster</div>
        <h3>Generation coefficient by cluster</h3>
        <p className="small muted">NO₂ enhancement (µmol/m²) per MU/day of reported generation.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cluster</th>
                <th className="num">Coefficient</th>
                <th className="num">p</th>
              </tr>
            </thead>
            <tbody>
              {coefs.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cluster/${c.id}`}>{names[c.id] ?? c.id}</Link>
                  </td>
                  <td className="num">{fmt(c.generation_coef, 3)}</td>
                  <td className="num">{fmtP(c.p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

export default function HowItWorks() {
  const summary = useAsync(fetchSummary, [])
  const clusters = useAsync(fetchClusters, [])
  const list = clusters.data?.clusters ?? []
  const names: Record<string, string> = Object.fromEntries(list.map((c) => [c.id, c.name]))
  const focus = [...list].sort((a, b) => b.risk_score - a.risk_score)[0]
  const ts = useAsync(() => (focus ? fetchTimeseries(focus.id) : Promise.resolve(undefined)), [focus?.id])

  const stage = useRef<HTMLDivElement>(null)
  // Scroll progress goes to refs and DOM; React re-renders only when the step changes.
  const progress = useRef(0)
  const sceneDrive = useRef<((p: number) => void) | null>(null)
  const register = useCallback<RegisterDrive>((fn) => {
    sceneDrive.current = fn
    return () => {
      if (sceneDrive.current === fn) sceneDrive.current = null
    }
  }, [])
  const counter = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const apply = (p: number) => {
      progress.current = p
      let k = 0
      METHOD_AT.forEach((a, i) => {
        if (p >= a) k = i
      })
      setStep(k)
      sceneDrive.current?.(p)
      const n = String(Math.round(p * 100)).padStart(3, '0')
      setText(counter.current, n)
      if (bar.current) bar.current.style.transform = `scaleX(${p.toFixed(4)})`
    }
    const st = ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', onUpdate: (s) => apply(s.progress) })
    apply(st.progress)
    return () => st.kill()
  }, [])

  return (
    <>
      <section className="section-tight hiw-intro">
        <BigWord style={{ top: '0.05em', right: '-0.04em' }}>Method</BigWord>
        <div className="container layer">
          <div className="micro signal reveal">How it works</div>
          <h1 className="display d-lg reveal" style={{ '--d': '80ms', margin: '14px 0 18px' } as CSSProperties}>
            From smokestack <span className="dim">to score.</span>
          </h1>
          <p className="lede reveal" style={{ '--d': '160ms' } as CSSProperties}>
            We check whether the NO₂ seen from space around each coal plant cluster matches the electricity the plants
            report generating, after allowing for weather and season. Scroll to rebuild the method.
          </p>
        </div>
      </section>

      <div className="hiw-stage" ref={stage}>
        <div className="hiw-sticky">
          <div className="container hiw-top">
            <ol className="row hiw-chips" aria-label="Method steps">
              {STEPS.map((s, i) => (
                <li key={s.chip} className={`chip ${i === step ? 'on' : i < step ? 'done' : ''}`}>
                  0{i + 1} {s.chip}
                </li>
              ))}
            </ol>
            <div className="micro hiw-progress">
              <span ref={counter} className="mono text">000</span> / 100
            </div>
          </div>
          <div className="container hiw-body">
            <div className="hiw-scene">
              <MethodScene
                register={register}
                progress={progress}
                residuals={ts.data?.months}
                score={focus?.risk_score}
                scoreColor={focus ? RISK_COLOR[focus.risk_level] : undefined}
                clusterName={focus?.name}
              />
            </div>
            <div className="hiw-text" aria-live="polite">
              {STEPS.map((s, i) => (
                <div key={s.chip} className={`hiw-step ${i === step ? 'on' : ''}`} aria-hidden={i !== step}>
                  <div className="micro signal">
                    0{i + 1} / 06 · {s.chip}
                  </div>
                  <h2 className="display d-md">{s.title}</h2>
                  {s.body.map((b) => (
                    <p key={b} className="muted">
                      {b}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="hiw-bar" aria-hidden="true">
            <div ref={bar} style={{ transform: 'scaleX(0)' }} />
          </div>
        </div>
      </div>

      {/* Static list of the steps for screen readers and no-scroll reading */}
      <ol className="sr-only">
        {STEPS.map((s) => (
          <li key={s.chip}>
            {s.title}. {s.body.join(' ')}
          </li>
        ))}
      </ol>

      <section className="container section-tight">
        <div className="note-signal reveal">
          <p className="muted" style={{ margin: 0 }}>
            Each score also carries a confidence level, lowered when the generation effect is weak, satellite coverage is
            thin, or plants in the area are missing from the reports. See <Link to="/limits">Limits</Link>.
          </p>
        </div>
      </section>

      <section className="container section-tight">
        {summary.error && <div className="alert err">Could not load results: {summary.error}</div>}
        {summary.data ? <Results s={summary.data} names={names} /> : !summary.error && <div className="loading micro">Loading results…</div>}
      </section>

      <section className="container section-tight">
        <div className="micro reveal" style={{ marginBottom: 16 }}>
          Data sources
        </div>
        <div className="rule draw" />
        <dl className="sources-list">
          {SOURCES.map(([name, what], i) => (
            <div key={name} className="reveal" style={{ '--d': `${i * 60}ms` } as CSSProperties}>
              <dt>{name}</dt>
              <dd className="muted">{what}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
