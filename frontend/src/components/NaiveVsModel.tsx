import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ClusterDetail, TimeseriesFile } from '../api'
import { useFlip } from '../lib/flip'
import { fmt, fmtP } from '../lib/format'

// "Why naive analysis misleads": the same 11 clusters, two ways.
//  Raw: Pearson r between monthly reported generation and observed NO2 (months with ≥ 50% valid
//       satellite coverage and full generation reports), computed here from the exported series.
//  Adjusted: the daily model's generation effect (Newey–West t), controlling for wind,
//       boundary-layer height and season (from each cluster's export).
type Row = { id: string; name: string; r: number; months: number; t: number; p: number; coef: number }

function pearson(a: number[], b: number[]) {
  const n = a.length
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n
  let sab = 0, sa = 0, sb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    sa += (a[i] - ma) ** 2
    sb += (b[i] - mb) ** 2
  }
  return sab / Math.sqrt(sa * sb)
}

export default function NaiveVsModel({ details, series }: { details: ClusterDetail[]; series: Record<string, TimeseriesFile> }) {
  const [view, setView] = useState<'raw' | 'model'>('raw')
  const list = useRef<HTMLOListElement>(null)
  const capture = useFlip(list, [view])
  const rows: Row[] = useMemo(
    () =>
      details
        .filter((c) => series[c.id])
        .map((c) => {
          const m = series[c.id].months.filter((x) => x.generation_mu != null && x.observed_no2 != null && (x.valid_fraction ?? 0) >= 0.5)
          const e = c.model.enhancement
          return { id: c.id, name: c.name, r: pearson(m.map((x) => x.generation_mu!), m.map((x) => x.observed_no2!)), months: m.length, t: e.t, p: e.p, coef: e.coef }
        }),
    [details, series],
  )
  if (rows.length < details.length || !rows.length) return <div className="loading micro">Loading the 11 series…</div>
  const sorted = [...rows].sort((a, b) => (view === 'raw' ? b.r - a.r : b.t - a.t))
  const neg = rows.filter((r) => r.r < 0)
  const weak = rows.filter((r) => r.r >= 0 && r.r < 0.3)
  const sig = rows.filter((r) => r.coef > 0 && r.p < 0.05)
  const maxT = Math.max(...rows.map((r) => r.t))
  const switchTo = (v: 'raw' | 'model') => {
    if (v === view) return
    capture()
    setView(v)
  }
  return (
    <div className="card nvm">
      <div className="nvm-head">
        <div>
          <div className="micro">Why naive analysis misleads</div>
          <h3>Same clusters, two analyses</h3>
        </div>
        <div className="seg" role="radiogroup" aria-label="Analysis">
          <button role="radio" aria-checked={view === 'raw'} className={`seg-btn ripple${view === 'raw' ? ' on' : ''}`} onClick={() => switchTo('raw')}>
            Raw correlation
          </button>
          <button role="radio" aria-checked={view === 'model'} className={`seg-btn ripple${view === 'model' ? ' on' : ''}`} onClick={() => switchTo('model')}>
            Weather-adjusted model
          </button>
          <span className={`seg-ind ${view}`} aria-hidden="true" />
        </div>
      </div>
      <p className="muted small nvm-explain" aria-live="polite">
        {view === 'raw' ? (
          <>
            Monthly reported generation against observed NO₂, nothing else. In {neg.length} of {rows.length} clusters (
            {neg.map((r) => r.name).join(', ')}) more generation even goes with <em>less</em> NO₂, and {weak.length} more are below r = 0.3.
            Wind, mixing height and season move NO₂ far more than output does.
          </>
        ) : (
          <>
            The daily model adds ERA5 wind, boundary-layer height and a seasonal cycle. Then generation shows a positive,
            statistically significant effect in {sig.length} of {rows.length} clusters (p &lt; 0.05). Bars: Newey–West t-statistic.
          </>
        )}
      </p>
      <div className="nvm-axis micro" aria-hidden="true">
        {view === 'raw' ? (
          <>
            <span>r = −1</span>
            <span>0</span>
            <span>+1</span>
          </>
        ) : (
          <>
            <span />
            <span>t = 0</span>
            <span>t = {fmt(maxT, 0)}</span>
          </>
        )}
      </div>
      <ol className="nvm-list" ref={list}>
        {sorted.map((r) => {
          const v = view === 'raw' ? r.r : r.t / maxT
          return (
            <li key={r.id} data-flip={r.id} className={`nvm-row ${v < 0 ? 'neg' : 'pos'}`}>
              <span className="nvm-name">{r.name}</span>
              <span className="nvm-track">
                <span className="nvm-bar" style={{ '--v': Math.abs(v).toFixed(3) } as CSSProperties} />
              </span>
              <span className="nvm-val mono">
                {view === 'raw' ? (
                  <>
                    r {r.r >= 0 ? '+' : '−'}
                    {fmt(Math.abs(r.r), 2)} <span className="muted">· {r.months} mo</span>
                  </>
                ) : (
                  <>
                    t {fmt(r.t, 1)} <span className="muted">· p {fmtP(r.p)}</span>
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
