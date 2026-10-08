import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchClusters } from '../api'
import { ConfidenceBadge, RiskBadge } from '../components/Badges'
import ClusterMap from '../components/ClusterMap'
import { RISK_COLOR, RISK_LABEL } from '../lib/format'
import { useAsync } from '../lib/useAsync'

export default function RiskMap() {
  const { data, error } = useAsync(fetchClusters, [])
  const [hover, setHover] = useState<string>()

  if (error) return <div className="container section alert err">Could not load clusters: {error}</div>
  if (!data) return <div className="container loading">Loading clusters…</div>

  const ranked = [...data.clusters].sort((a, b) => b.risk_score - a.risk_score)

  return (
    <div className="container section">
      <h1>Audit Risk Map</h1>
      <p className="lede">
        Eleven coal plant clusters, scored 0–100 on how far satellite NO₂ departs from what reported generation and
        weather predict. Data as of {data.as_of}. Click a cluster for details.
      </p>
      <div className="map-layout" style={{ marginTop: 24 }}>
        <div>
          <div className="map-box">
            <ClusterMap clusters={data.clusters} highlight={hover} onHover={setHover} />
          </div>
          <div className="legend" aria-label="Legend">
            {(['high', 'medium', 'low'] as const).map((l) => (
              <span key={l}>
                <span className="badge" style={{ padding: 0, border: 0 }}>
                  <span className="dot" style={{ background: RISK_COLOR[l] }} />
                </span>
                {RISK_LABEL[l]}
              </span>
            ))}
            <span>Circle size = installed capacity</span>
          </div>
        </div>
        <div>
          <h2 style={{ fontSize: '1.2rem' }}>Ranked by risk score</h2>
          <ol className="rank-list">
            {ranked.map((c, i) => (
              <li key={c.id}>
                <Link
                  to={`/cluster/${c.id}`}
                  className={`rank-item${hover === c.id ? ' hl' : ''}`}
                  onMouseEnter={() => setHover(c.id)}
                  onMouseLeave={() => setHover(undefined)}
                  onFocus={() => setHover(c.id)}
                  onBlur={() => setHover(undefined)}
                >
                  <span className="rank-pos">{i + 1}</span>
                  <span>
                    <span className="rank-name">{c.name}</span>
                    <span className="muted small"> · {c.states.join(', ')}</span>
                    <span style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <RiskBadge level={c.risk_level} />
                      <ConfidenceBadge confidence={c.confidence} />
                    </span>
                  </span>
                  <span className="rank-score">
                    <span className="n">{Math.round(c.risk_score)}</span>
                    <span className="muted small">/ 100</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
