import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BacktestRow, SummaryFile } from '../api'
import { fetchClusters, fetchSummary } from '../api'
import { fmt, fmtP, fmtPct } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const NO2 = '#eb6834'
const PREDICTED = '#4b5563'
const AXIS = { fontSize: 12, fill: '#6b7280' }

const STEPS = [
  {
    title: 'Group plants into clusters',
    body: 'Satellite pixels are about 5 km across, so nearby plants blur together. We group 33 plants into 11 clusters whose centres are at least 100 km apart.',
  },
  {
    title: 'Collect reported generation',
    body: 'We download about 2,800 daily generation reports (CEA, via the National Power Portal) from January 2019 and add up each cluster’s output per day.',
  },
  {
    title: 'Measure NO₂ from space',
    body: 'Sentinel-5P measures nitrogen dioxide daily. For each cluster we take the average within 20 km and subtract the background 50–80 km away, leaving the local enhancement. Cloudy days are dropped.',
  },
  {
    title: 'Account for weather and season',
    body: 'Wind spreads NO₂ out and a deeper mixing layer dilutes it. We add ERA5 wind speed and boundary-layer height for each day, plus a seasonal cycle.',
  },
  {
    title: 'Predict, then compare',
    body: 'A regression predicts each day’s NO₂ from reported generation, weather and season. The gap between observed and predicted is the residual.',
  },
  {
    title: 'Score sustained patterns',
    body: 'The Audit Risk Score combines three signals: how far the last 90 days of residuals sit above the cluster’s own history (50%), the trend in NO₂ per unit of electricity (25%), and NO₂ per unit compared with other clusters (25%).',
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
  const data = rows
    .filter((r) => r.cluster !== 'POOLED')
    .map((r) => ({ ...r, name: names[r.cluster] ?? r.cluster }))
    .sort((a, b) => a.observed_change_pct - b.observed_change_pct)
  return (
    <div className="card chart-card">
      <h3>2020 lockdown: NO₂ change, observed vs predicted</h3>
      <p className="muted small">
        Apr–May 2020 compared with Apr–May 2019. The model was refitted without Mar–Jun 2020 and asked to predict the
        lockdown from reported generation and weather alone.
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
      <ResponsiveContainer width="100%" height={360}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 40 }} barGap={2}>
          <CartesianGrid stroke="#e3e5e9" vertical={false} />
          <XAxis dataKey="name" tick={AXIS} interval={0} angle={-35} textAnchor="end" />
          <YAxis tick={AXIS} width={48} tickFormatter={(v: number) => `${v}%`} />
          <ReferenceLine y={0} stroke="#9ca3af" />
          <Tooltip formatter={(v, n) => [fmtPct(v as number), n]} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="observed_change_pct" name="Observed" fill={NO2} radius={[2, 2, 2, 2]} isAnimationActive={false} />
          <Bar
            dataKey="predicted_change_pct"
            name="Predicted"
            fill={PREDICTED}
            radius={[2, 2, 2, 2]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
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
      <h2>Results</h2>
      <div className="grid grid-2">
        <div className="card">
          <h3>Generation shows up in the satellite data</h3>
          <p>
            Across all clusters (pooled model with cluster effects), each extra MU of daily generation adds{' '}
            <strong>{fmt(pooled.coef, 2)} µmol/m²</strong> of NO₂ (t = {fmt(pooled.t, 1)}, p {fmtP(pooled.p)},{' '}
            {pooled.n.toLocaleString('en-IN')} cluster-days). The effect is statistically clear, but generation
            explains only a small share of day-to-day variation (partial R² = {fmt(pooled.partial_r2, 3)}); weather and
            season explain far more.
          </p>
        </div>
        <div className="card">
          <h3>Findings</h3>
          <ol style={{ paddingLeft: '1.2em', marginBottom: 0 }}>
            {s.findings.map((f) => (
              <li key={f} style={{ marginBottom: 8 }}>
                {f}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <BacktestChart rows={bt} names={names} />
      </div>
      {pooledBt && (
        <p className="small" style={{ marginTop: 12 }}>
          Pooled across clusters, the model predicted {fmt(pooledBt.predicted_2020)} µmol/m² for Apr–May 2020; the
          satellite observed {fmt(pooledBt.observed_2020)} (2019: {fmt(pooledBt.observed_2019)}). The model
          over-predicted in {over} of {bt.length - 1} clusters: it has no term for traffic, industry and other non-power
          sources that also fell during the lockdown.
        </p>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Generation coefficient by cluster</h3>
        <p className="small muted">NO₂ enhancement (µmol/m²) per MU/day of reported generation, daily model.</p>
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
  const names: Record<string, string> = Object.fromEntries((clusters.data?.clusters ?? []).map((c) => [c.id, c.name]))

  return (
    <>
      <section className="container section">
        <div className="prose">
          <h1>How it works</h1>
          <p className="lede">
            We check whether the NO₂ seen from space around each coal plant cluster matches the electricity the plants
            report generating, after allowing for weather and season.
          </p>
        </div>
        <div className="grid grid-3" style={{ marginTop: 24 }}>
          {STEPS.map((s, i) => (
            <div className="card" key={s.title}>
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
        <div className="note" style={{ marginTop: 24 }}>
          <p>
            Each score also carries a confidence level, lowered when the generation effect is weak, satellite coverage
            is thin, or plants in the area are missing from the reports. See <Link to="/limits">Limits</Link>.
          </p>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <h2>Data sources</h2>
          <div className="table-wrap">
            <table style={{ background: '#fff' }}>
              <tbody>
                {SOURCES.map(([name, what]) => (
                  <tr key={name}>
                    <th scope="row" style={{ width: '40%' }}>
                      {name}
                    </th>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="container section">
        {summary.error && <div className="alert err">Could not load results: {summary.error}</div>}
        {summary.data ? <Results s={summary.data} names={names} /> : !summary.error && <div className="loading">Loading results…</div>}
      </section>
    </>
  )
}
