import { useCallback, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchClusters } from '../api'
import { ConfidenceBadge, RiskBadge } from '../components/Badges'
import BigWord from '../components/BigWord'
import ClusterMap from '../components/ClusterMap'
import CountUp from '../components/CountUp'
import { RISK_COLOR, RISK_LABEL } from '../lib/format'
import { prefersReducedMotion } from '../lib/motion'
import { useAsync } from '../lib/useAsync'
import './riskmap.css'

export default function RiskMap() {
  const { data, error } = useAsync(fetchClusters, [])
  const [hover, setHover] = useState<string>()
  const [flying, setFlying] = useState<string>()
  const navigate = useNavigate()

  const select = (id: string) => {
    if (prefersReducedMotion()) navigate(`/cluster/${id}`)
    else setFlying(id)
  }
  const arrive = useCallback(() => {
    if (flying) navigate(`/cluster/${flying}`)
  }, [flying, navigate])

  if (error)
    return (
      <div className="container section">
        <div className="alert err">Could not load clusters: {error}</div>
      </div>
    )
  if (!data) return <div className="container loading micro">Loading clusters…</div>

  const ranked = [...data.clusters].sort((a, b) => b.risk_score - a.risk_score)
  const target = data.clusters.find((c) => c.id === flying)

  return (
    <div className="section-tight riskmap">
      <BigWord style={{ top: '0.05em', right: '-0.04em' }}>Map</BigWord>
      <div className="container layer">
        <div className="micro signal reveal">Audit risk map · data as of {data.as_of}</div>
        <h1 className="display d-lg reveal" style={{ '--d': '80ms', margin: '14px 0 18px' } as CSSProperties}>
          {data.clusters.length} clusters. <span className="dim">One score each.</span>
        </h1>
        <p className="lede reveal" style={{ '--d': '160ms' } as CSSProperties}>
          Scored 0–100 on how far satellite NO₂ departs from what reported generation and weather predict. Select a
          cluster to fly in.
        </p>

        <div className="map-layout">
          <div className="reveal" style={{ '--d': '200ms' } as CSSProperties}>
            <div className="map-box">
              <ClusterMap
                clusters={data.clusters}
                highlight={hover ?? flying}
                onHover={setHover}
                onSelect={select}
                flyTo={target}
                onArrive={arrive}
              />
            </div>
            <div className="legend" aria-label="Legend">
              {(['high', 'medium', 'low'] as const).map((l) => (
                <span key={l}>
                  <i style={{ borderColor: RISK_COLOR[l], boxShadow: `0 0 8px ${RISK_COLOR[l]}` }} />
                  {RISK_LABEL[l]}
                </span>
              ))}
              <span className="micro">Ring size = installed capacity</span>
            </div>
          </div>

          <div>
            <div className="micro" style={{ marginBottom: 12 }}>
              Ranked by risk score
            </div>
            <ol className="rank-list">
              {ranked.map((c, i) => (
                <li key={c.id} className="reveal" style={{ '--d': `${240 + i * 60}ms` } as CSSProperties}>
                  <Link
                    to={`/cluster/${c.id}`}
                    className={`rank-item${hover === c.id || flying === c.id ? ' hl' : ''}`}
                    style={{ '--rc': RISK_COLOR[c.risk_level] } as CSSProperties}
                    onMouseEnter={() => setHover(c.id)}
                    onMouseLeave={() => setHover(undefined)}
                    onFocus={() => setHover(c.id)}
                    onBlur={() => setHover(undefined)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return
                      e.preventDefault()
                      select(c.id)
                    }}
                  >
                    <span className="rank-pos mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="rank-body">
                      <span className="rank-name">{c.name}</span>
                      <span className="micro"> {c.states.join(' · ')}</span>
                      <span className="row" style={{ gap: 6, marginTop: 8 }}>
                        <RiskBadge level={c.risk_level} />
                        <ConfidenceBadge confidence={c.confidence} />
                      </span>
                    </span>
                    <span className="rank-score">
                      <CountUp value={Math.round(c.risk_score)} duration={1200} className="n" />
                      <span className="micro">/100</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
