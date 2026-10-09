import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BacktestRow, ClusterDetail, SummaryFile, TimeseriesFile } from '../api'
import { fetchCluster, fetchClusters, fetchSummary, fetchTimeseries, peekClusters, peekSummary } from '../api'
import CountUp from '../components/CountUp'
import MaskLines from '../components/MaskLines'
import { IconTile, type IconName } from '../components/Icons'
import { SatellitePlantScene } from '../components/Illustrations'
import MethodScene from '../components/MethodScene'
import NaiveVsModel from '../components/NaiveVsModel'
import PageHero, { Divider, type TickerItem } from '../components/PageHero'
import PipelineNodes, { type PipeStep } from '../components/PipelineNodes'
import SectionHead from '../components/SectionHead'
import { fmt, fmtInt, fmtP, fmtPct, RISK_COLOR } from '../lib/format'
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

const STEP_ICONS: IconName[] = ['plant', 'satellite', 'layers', 'wind', 'chart', 'shield']

const SOURCES = [
  ['Central Electricity Authority (CEA)', 'Daily generation report (DGR) per plant and unit'],
  ['National Power Portal', 'Public archive of the CEA daily reports'],
  ['ESA Sentinel-5P TROPOMI', 'Daily tropospheric NO₂ column'],
  ['Google Earth Engine', 'Satellite and weather data processing'],
  ['ECMWF ERA5', 'Hourly wind and boundary-layer height'],
  ['Global Energy Monitor', 'Plant locations and capacity, including plants not in CEA reports'],
]

const GEN = '#2a78d6'
// Clusters the findings name: generation fell sharply and NO2 fell with it.
const FELL_WITH = ['chandrapur', 'ramagundam', 'marwa']
const EXCEPTION = 'mundra'
const CLIP = 50 // % axis limit; larger changes are drawn as a broken bar with the true value printed on it

// Generation bar: bars past the axis limit get a zig-zag break near the end and their real value.
type BarShape = { x?: number; y?: number; width?: number; height?: number; fill?: string; fillOpacity?: number | string; stroke?: string; payload?: BacktestRow }
function GenBar({ x = 0, y = 0, width = 0, height = 0, fill, fillOpacity, stroke, payload }: BarShape) {
  const top = Math.min(y, y + height), h = Math.abs(height)
  const v = payload?.gen_change_pct ?? 0
  const off = Math.abs(v) > CLIP && h > 24 // (h grows during the entry animation)
  const up = v > 0
  const by = up ? top + 12 : top + h - 12 // break position, near the far end
  const zig = `M${x - 2} ${by + 3} L${x + width / 3} ${by - 1} L${x + (2 * width) / 3} ${by + 3} L${x + width + 2} ${by - 1}`
  return (
    <g>
      <g opacity={fillOpacity}>
        <rect x={x} y={top} width={width} height={h} rx={2} fill={fill} stroke={stroke} />
        {off && <path d={zig} transform="translate(0 -3)" stroke="#0e1217" strokeWidth={4} fill="none" />}
      </g>
      {off && (
        <text x={x + width / 2} y={up ? top - 8 : top + h + 14} textAnchor="middle" className="bt-off">
          {fmtPct(v)}
        </text>
      )}
    </g>
  )
}

function BtTip({ active, payload }: { active?: boolean; payload?: { payload: BacktestRow & { name: string } }[] }) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null
  return (
    <div className="ctip">
      <div className="ctip-head micro">{r.name} · Apr–May 2020 vs 2019</div>
      <dl>
        <dt><i style={{ background: GEN }} />Generation</dt>
        <dd className="mono">{fmtPct(r.gen_change_pct)}</dd>
        <dt><i style={{ background: NO2 }} />Observed NO₂</dt>
        <dd className="mono">{fmtPct(r.observed_change_pct)}</dd>
        <dt><i style={{ background: PREDICTED }} />Predicted NO₂</dt>
        <dd className="mono">{fmtPct(r.predicted_change_pct)}</dd>
        <dt>Days (2019 / 2020)</dt>
        <dd className="mono">{r.days_2019} / {r.days_2020}</dd>
      </dl>
    </div>
  )
}

function BacktestChart({ rows, names }: { rows: BacktestRow[]; names: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null)
  const show = useInView(ref)
  const reduced = useReducedMotion()
  const [focus, setFocus] = useState(true)
  const data = rows
    .filter((r) => r.cluster !== 'POOLED')
    .map((r) => ({ ...r, name: names[r.cluster] ?? r.cluster, gen: Math.max(-CLIP, Math.min(CLIP, r.gen_change_pct)) }))
    .sort((a, b) => a.gen_change_pct - b.gen_change_pct)
  const op = (id: string) => (!focus || FELL_WITH.includes(id) || id === EXCEPTION ? 1 : 0.22)
  const fell = data.filter((r) => FELL_WITH.includes(r.cluster))
  const ex = data.find((r) => r.cluster === EXCEPTION)
  const off = data.filter((r) => Math.abs(r.gen_change_pct) > CLIP)
  return (
    <div className="card reveal bt-card" ref={ref}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="micro">Backtest · Apr–May 2020 vs Apr–May 2019</div>
          <h3>2020 lockdown: generation, observed and predicted NO₂</h3>
        </div>
        <button type="button" className={`fchip ripple${focus ? ' on' : ''}`} aria-pressed={focus} onClick={() => setFocus((f) => !f)}>
          Highlight the findings
        </button>
      </div>
      <p className="muted small">
        The model was refitted without Mar–Jun 2020 and asked to predict the lockdown from reported generation and
        weather alone. Sorted by the change in reported generation.
      </p>
      <div className="chart-legend">
        <span><i className="sq" style={{ background: GEN }} />Generation</span>
        <span><i className="sq" style={{ background: NO2 }} />Observed NO₂</span>
        <span><i className="sq" style={{ background: PREDICTED }} />Predicted NO₂</span>
      </div>
      <div style={{ height: 380, margin: '0 -6px' }}>
        {show && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 26, right: 8, left: 0, bottom: 44 }} barGap={1} barCategoryGap="18%">
              <CartesianGrid stroke="#1c232b" vertical={false} />
              <XAxis dataKey="name" tick={AXIS} interval={0} angle={-35} textAnchor="end" stroke="#1c232b" />
              <YAxis tick={AXIS} width={44} domain={[-CLIP, CLIP]} ticks={[-50, -25, 0, 25, 50]} tickFormatter={(v: number) => `${v}%`} stroke="#1c232b" />
              <ReferenceLine y={0} stroke="#2a333d" />
              <Tooltip content={<BtTip />} cursor={{ fill: 'rgba(124,232,216,0.05)' }} />
              {(['gen', 'observed_change_pct', 'predicted_change_pct'] as const).map((k, j) => (
                <Bar key={k} dataKey={k} name={k} fill={[GEN, NO2, PREDICTED][j]} radius={[2, 2, 2, 2]} shape={j === 0 ? GenBar : undefined} isAnimationActive={!reduced} animationDuration={1100} animationBegin={j * 180}>
                  {data.map((r) => (
                    <Cell key={r.cluster} fillOpacity={op(r.cluster)} stroke={focus && r.cluster === EXCEPTION ? '#e8edf2' : undefined} strokeWidth={1} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="bt-notes">
        <p className="small">
          <span className="bt-tag">Fell together</span>
          {fell.map((r, i) => (
            <span key={r.cluster}>
              {i ? '; ' : ''}
              {r.name}: generation {fmtPct(r.gen_change_pct)}, NO₂ {fmtPct(r.observed_change_pct)}
            </span>
          ))}
          .
        </p>
        {ex && (
          <p className="small">
            <span className="bt-tag ember">Exception</span>
            {ex.name}: generation {fmtPct(ex.gen_change_pct)}, yet NO₂ {fmtPct(ex.observed_change_pct)}: here NO₂ did not follow reported generation.
          </p>
        )}
        {off.map((r) => (
          <p key={r.cluster} className="micro">
            {r.name} generation {fmtPct(r.gen_change_pct)} runs past the ±{CLIP}% scale, so its bar is broken ({r.days_2019} days in 2019, {r.days_2020} in 2020).
          </p>
        ))}
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
      <SectionHead n="02" label="Results" />
      <h2 className="display d-lg mask" style={{ margin: '14px 0 36px' }}>
        <MaskLines lines={['What the data', 'shows.']} delay={80} />
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
  const summary = useAsync(fetchSummary, [], peekSummary)
  const clusters = useAsync(fetchClusters, [], peekClusters)
  const list = clusters.data?.clusters ?? []
  const names: Record<string, string> = Object.fromEntries(list.map((c) => [c.id, c.name]))
  const focus = [...list].sort((a, b) => b.risk_score - a.risk_score)[0]
  const ts = useAsync(() => (focus ? fetchTimeseries(focus.id) : Promise.resolve(undefined)), [focus?.id])
  // All 11 cluster files and series for the raw-vs-model comparison.
  const [all, setAll] = useState<{ details: ClusterDetail[]; series: Record<string, TimeseriesFile> }>()
  const ids = list.map((c) => c.id).join(',')
  useEffect(() => {
    if (!ids) return
    let live = true
    const idl = ids.split(',')
    Promise.all([Promise.all(idl.map(fetchCluster)), Promise.all(idl.map(fetchTimeseries))]).then(
      ([details, series]) => live && setAll({ details, series: Object.fromEntries(series.map((t) => [t.id, t])) }),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [ids])
  const ticker: TickerItem[] = useMemo(() => {
    const s = summary.data
    if (!s) return []
    const e = s.pooled_model.enhancement
    const pb = s.backtest.find((r) => r.cluster === 'POOLED')
    const over = s.backtest.filter((r) => r.cluster !== 'POOLED' && r.error > 0).length
    return [
      { label: 'Pooled effect', value: `${fmt(e.coef, 2)} µmol/m² per MU/day` },
      { label: 't-statistic', value: fmt(e.t, 1) },
      { label: 'Cluster-days', value: e.n.toLocaleString('en-IN') },
      { label: 'Partial R²', value: fmt(e.partial_r2, 3) },
      ...(pb ? [{ label: 'Lockdown 2020 pooled NO₂', value: `${fmt(pb.observed_2020)} observed · ${fmt(pb.predicted_2020)} predicted` }] : []),
      { label: 'Model over-predicted', value: `${over} of ${s.backtest.length - 1} clusters`, color: '#ff8a3d' },
    ]
  }, [summary.data])

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

  const pipe: PipeStep[] = useMemo(() => {
    const e = summary.data?.pooled_model.enhancement
    const cl = clusters.data?.clusters ?? []
    const plants = cl.reduce((a, c) => a + c.n_plants, 0)
    const mw = cl.reduce((a, c) => a + c.capacity_mw, 0)
    return [
      { id: '01', label: 'The claim', value: cl.length ? `CEA · ${plants} plants · ${fmtInt(mw)} MW` : 'CEA daily generation', icon: 'doc' },
      { id: '02', label: 'The observation', value: 'Sentinel-5P NO₂ · 20 km rings', icon: 'satellite' },
      { id: '03', label: 'The comparison', value: e ? `+ ERA5 weather · t ${fmt(e.t, 1)}` : '+ ERA5 weather', icon: 'chart' },
      { id: '04', label: 'The score', value: focus ? `${focus.name} ${Math.round(focus.risk_score)}/100` : 'Audit risk 0–100', icon: 'shield', tone: 'ember' },
    ]
  }, [summary.data, clusters.data, focus])

  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="From smokestack"
        dim="to score."
        lede="We check whether the NO₂ seen from space around each coal plant cluster matches the electricity the plants report generating, after allowing for weather and season. Scroll to rebuild the method."
        word="Method"
        visual={<PipelineNodes steps={pipe} />}
        ticker={ticker}
      />

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
                  <div className="hiw-step-head">
                    <IconTile name={STEP_ICONS[i]} tone={i === 5 ? 'ember' : 'signal'} />
                    <div className="micro signal">
                      0{i + 1} / 06 · {s.chip}
                    </div>
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

      <section className="container section-tight note-wrap">
        <div className="note-signal reveal">
          <p className="muted" style={{ margin: 0 }}>
            Each score also carries a confidence level, lowered when the generation effect is weak, satellite coverage is
            thin, or plants in the area are missing from the reports. See <Link to="/limits">Limits</Link>.
          </p>
        </div>
        <SatellitePlantScene className="note-il reveal" label="A satellite scanning a coal plant, with measurement rings on the ground" />
      </section>

      <section className="container section-tight">
        <SectionHead n="01" label="Why the model, not a simple correlation" />
        <h2 className="display d-lg mask" style={{ margin: '14px 0 28px' }}>
          <MaskLines lines={['Weather hides', 'the signal.']} delay={80} />
        </h2>
        <div className="reveal" style={{ '--d': '160ms' } as CSSProperties}>
          {all ? <NaiveVsModel details={all.details} series={all.series} /> : <div className="loading micro">Loading the 11 clusters…</div>}
        </div>
        <Divider />
      </section>

      <section className="container section-tight">
        {summary.error && <div className="alert err">Could not load results: {summary.error}</div>}
        {summary.data ? <Results s={summary.data} names={names} /> : !summary.error && <div className="loading micro">Loading results…</div>}
      </section>

      <section className="container section-tight">
        <div style={{ marginBottom: 16 }}>
          <SectionHead n="03" label="Data sources" />
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
