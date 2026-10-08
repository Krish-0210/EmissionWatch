import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ClusterDetail, ModelStats } from '../api'
import { briefAvailable, fetchCluster, fetchTimeseries, generateBrief } from '../api'
import { ConfidenceBadge, RiskBadge } from '../components/Badges'
import { GenerationChart, No2Chart } from '../components/ClusterCharts'
import Markdown from '../components/Markdown'
import { fmt, fmtInt, fmtP } from '../lib/format'
import { useAsync } from '../lib/useAsync'

function Signals({ c }: { c: ClusterDetail }) {
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
    <div className="card">
      <h2 style={{ fontSize: '1.2rem' }}>What drives the score</h2>
      {rows.map((r) => (
        <div className="signal" key={r.key}>
          <strong>{r.title}</strong>
          <span className="small muted">
            {fmt(r.score, 0)}/100 × {c.weights[r.key]} = <strong>{fmt(r.score * c.weights[r.key], 1)}</strong>
          </span>
          <div className="bar" role="img" aria-label={`${r.title}: ${Math.round(r.score)} out of 100`}>
            <div style={{ width: `${r.score}%` }} />
          </div>
          <span className="small" style={{ gridColumn: '1 / -1' }}>
            {r.detail}
          </span>
        </div>
      ))}
      <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
        Risk score = {fmt(c.risk_score, 1)}. Below 40 is low, below 65 medium, otherwise high.
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
      <h2 style={{ fontSize: '1.2rem' }}>Model statistics</h2>
      <p className="small muted">
        Daily regression of NO₂ on reported generation, wind speed, boundary-layer height and season, with
        Newey–West standard errors. The coefficient is how much NO₂ rises per unit of daily generation.
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
    <div className="card">
      <h2 style={{ fontSize: '1.2rem' }}>Plants in this cluster</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plant</th>
              <th>State</th>
              <th className="num">Capacity (MW)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {c.plants.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.state}</td>
                <td className="num">{fmtInt(p.capacity_mw)}</td>
                <td>{p.status === 'operating' ? 'Operating' : 'Retired'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.coverage.unreported_capacity_mw > 0 && (
        <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
          {fmtInt(c.coverage.unreported_capacity_mw)} MW of the {fmtInt(c.coverage.ring_capacity_mw)} MW of coal
          capacity inside the 20 km ring is not in CEA generation reports: {c.coverage.unreported_plants.join('; ')}.
          The satellite sees their NO₂, but reported generation does not include them.
        </p>
      )}
    </div>
  )
}

function ConfidenceCard({ c }: { c: ClusterDetail }) {
  return (
    <div className="card">
      <h2 style={{ fontSize: '1.2rem' }}>Confidence: {c.confidence}</h2>
      <p className="small">
        Confidence starts high and drops one level for each issue: the generation effect is not statistically clear
        (enhancement p ≥ 0.01 or ratio p ≥ 0.05), generation explains under 1% of the remaining variation, fewer than
        120 valid satellite days in the last year, or more than 10% of the coal capacity in the ring is missing from CEA
        reports.
      </p>
      {c.confidence_notes.length ? (
        <>
          <p className="small" style={{ marginBottom: 4 }}>
            <strong>Issues found:</strong>
          </p>
          <ul className="small" style={{ marginTop: 0 }}>
            {c.confidence_notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="small">
          <strong>No issues found.</strong>
        </p>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        {c.coverage.recent_valid_days} valid satellite days in the last 365.
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
    <div className="card">
      <h2 style={{ fontSize: '1.2rem' }}>Inspection brief</h2>
      <p className="small muted">A short written brief for inspectors, generated from this cluster’s data.</p>
      <button className="btn btn-primary" onClick={run} disabled={state.loading}>
        {state.loading ? 'Generating…' : 'Generate inspection brief'}
      </button>
      <div aria-live="polite" style={{ marginTop: 16 }}>
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
  if (!c) return <div className="container loading">Loading…</div>

  return (
    <div className="container section">
      <p className="small">
        <Link to="/map">← Risk Map</Link>
      </p>
      <div className="detail-head">
        <div style={{ flex: '1 1 420px' }}>
          <h1>{c.name}</h1>
          <p className="muted">
            {c.states.join(', ')} · {c.n_plants} operating plant{c.n_plants === 1 ? '' : 's'} ·{' '}
            {fmtInt(c.capacity_mw)} MW · data as of {c.as_of}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <RiskBadge level={c.risk_level} />
            <ConfidenceBadge confidence={c.confidence} />
          </div>
          <p className="lede" style={{ fontSize: '1.05rem' }}>
            {c.headline}
          </p>
        </div>
        <div className="card" style={{ textAlign: 'center', minWidth: 160 }}>
          <div className="small muted">Audit risk score</div>
          <div className="score-big">{Math.round(c.risk_score)}</div>
          <div className="small muted">out of 100</div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 24 }}>
        {ts.error && <div className="alert err">Could not load time series: {ts.error}</div>}
        {ts.data ? (
          <>
            <No2Chart months={ts.data.months} />
            <GenerationChart months={ts.data.months} />
          </>
        ) : (
          !ts.error && <div className="loading">Loading charts…</div>
        )}
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Signals c={c} />
        <ConfidenceCard c={c} />
      </div>
      <div className="grid" style={{ marginTop: 16 }}>
        <ModelTable c={c} />
        <Plants c={c} />
        <BriefPanel id={c.id} />
      </div>
      <p className="small muted" style={{ marginTop: 24 }}>
        A high score marks an anomaly that warrants an audit, not proof of a violation.{' '}
        <Link to="/limits">Read the limits</Link>.
      </p>
    </div>
  )
}
