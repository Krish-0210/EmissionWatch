import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { ClusterSummary } from '../api'
import { fetchCluster, fetchClusters, peekClusters } from '../api'
import { RiskBadge } from '../components/Badges'
import CountUp from '../components/CountUp'
import Icon, { IconTile } from '../components/Icons'
import { RingsCityScene } from '../components/Illustrations'
import PageHero, { Divider, type TickerItem } from '../components/PageHero'
import { fmtInt, plainHeadline, RISK_COLOR, RISK_LABEL } from '../lib/format'
import { bearingDeg, distanceKm, STATE_CENTRES } from '../lib/geo'
import { useAsync } from '../lib/useAsync'
import './nearme.css'

type Origin = { lat: number; lon: number; label: string }
type Near = { c: ClusterSummary; km: number; deg: number }
const INDIA_CENTRE: Origin = { lat: 22.5, lon: 81.5, label: 'the centre of India' }

function Radar({ scanning, near, focus = 3, mini = false, range }: { scanning: boolean; near: Near[]; focus?: number; mini?: boolean; range?: number }) {
  const maxKm = range ?? Math.max(300, ...near.map((n) => n.km)) * 1.12
  return (
    <div className={`radar${scanning ? ' scanning' : ''}${mini ? ' mini' : ''}`} aria-hidden="true">
      <svg viewBox="-100 -100 200 200">
        {[25, 50, 75, 98].map((r) => (
          <circle key={r} r={r} className="radar-ring" />
        ))}
        <line x1="-98" y1="0" x2="98" y2="0" className="radar-ring" />
        <line x1="0" y1="-98" x2="0" y2="98" className="radar-ring" />
        {!mini && (
          <>
            <text x="0" y="-90" className="radar-n" textAnchor="middle">N</text>
            <text x="90" y="3" className="radar-n" textAnchor="middle">E</text>
          </>
        )}
        <circle r="2.5" className="radar-me" />
        {near.map((n, i) => {
          const r = (n.km / maxKm) * 96
          if (r > 97) return null
          const a = (n.deg * Math.PI) / 180
          const hot = i < focus
          return (
            <g
              key={n.c.id}
              transform={`translate(${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)})`}
              className={`blip${hot ? ' hot' : ''}`}
              style={{ '--d': `${200 + i * 140}ms`, '--c': RISK_COLOR[n.c.risk_level] } as CSSProperties}
            >
              <circle r="9" className="blip-ring" />
              <circle r={hot ? 3.6 : 2.4} className="blip-dot" />
              {hot && !mini && (
                <text x={i % 2 ? -6 : 6} y={i === 2 ? 12 : -6} textAnchor={i % 2 ? 'end' : 'start'} className="blip-label">
                  {n.c.name.toUpperCase()}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="radar-sweep" />
      <div className="micro radar-scale">Outer ring ≈ {fmtInt(Math.round(maxKm / 50) * 50)} km</div>
    </div>
  )
}

export default function NearMe() {
  const { data, error } = useAsync(fetchClusters, [], peekClusters)
  const [origin, setOrigin] = useState<Origin>()
  const [state, setState] = useState('')
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string>()

  const pickState = (s: string) => {
    setState(s)
    setGeoError(undefined)
    setOrigin(s ? { lat: STATE_CENTRES[s][0], lon: STATE_CENTRES[s][1], label: s } : undefined)
  }

  const locateMe = () => {
    if (!navigator.geolocation) {
      setGeoError('Your browser cannot share its location. Please pick your state instead.')
      return
    }
    setLocating(true)
    setGeoError(undefined)
    setOrigin(undefined)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setState('')
        setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'your location' })
      },
      () => {
        setLocating(false)
        setGeoError('We could not get your location. Please pick your state instead.')
      },
      { timeout: 10000, maximumAge: 600000 },
    )
  }

  const from = origin ?? INDIA_CENTRE
  const all: Near[] = useMemo(
    () =>
      (data?.clusters ?? [])
        .map((c) => ({ c, km: distanceKm(from.lat, from.lon, c.lat, c.lon), deg: bearingDeg(from.lat, from.lon, c.lat, c.lon) }))
        .sort((a, b) => a.km - b.km),
    [data, from.lat, from.lon],
  )
  const nearest = origin ? all.slice(0, 3) : []
  const closest = nearest[0]

  const ticker: TickerItem[] = useMemo(() => {
    if (!data) return []
    const states = [...new Set(data.clusters.flatMap((c) => c.states))].sort()
    return [
      { label: 'Clusters covered', value: String(data.clusters.length) },
      { label: 'Operating coal capacity', value: `${fmtInt(data.clusters.reduce((a, c) => a + c.capacity_mw, 0))} MW` },
      { label: 'States', value: states.join(' · ') },
      { label: 'Data as of', value: data.as_of },
      { label: 'Your location', value: 'stays in your browser' },
    ]
  }, [data])

  return (
    <div className="nearme-page">
      <PageHero
        eyebrow={
          <>
            <Icon name="pin" size={18} /> Near me
          </>
        }
        title="Coal plants"
        dim="near you."
        lede="See the large coal power plant areas closest to you, and whether satellite readings match what they report."
        word="Near"
        visual={<Radar scanning={locating || !origin} near={all} focus={nearest.length} range={origin && all[2] ? Math.max(300, all[2].km * 1.5) : undefined} key={`${from.lat},${from.lon}`} />}
        ticker={ticker}
      >
        <div className="near-controls">
          <label htmlFor="state" className="sr-only">
            Choose your state
          </label>
          <select id="state" value={state} onChange={(e) => pickState(e.target.value)} className="near-select">
            <option value="">Choose your state…</option>
            {Object.keys(STATE_CENTRES).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="micro">or</span>
          <button className="pill magnetic" onClick={locateMe} disabled={locating}>
            <Icon name="pin" size={18} draw={false} /> {locating ? 'Finding you…' : 'Use my location'}
          </button>
        </div>
        <p className="small muted near-privacy">Your location stays in your browser. It is not sent anywhere.</p>
        {geoError && (
          <div className="alert err" role="alert">
            {geoError}
          </div>
        )}
      </PageHero>

      <div className="container layer section-tight">
        {error && <div className="alert err">Could not load data: {error}</div>}

        {!origin && data && (
          <div className="near-empty reveal">
            <IconTile name="scan" />
            <p className="muted">
              Pick your state or share your location above. The radar shows all {data.clusters.length} clusters by distance and
              direction from {from.label} until you do.
            </p>
          </div>
        )}

        {origin && data && (
          <section className="near-results" aria-live="polite" key={`${origin.lat},${origin.lon}`}>
            <div className="micro" style={{ marginBottom: 18 }}>
              Closest to <span className="text">{origin.label}</span>
            </div>
            <div className="near-orbit spot-group">
              <div className="near-center">
                <Radar scanning={false} near={nearest} mini />
              </div>
              {nearest.map(({ c, km, deg }, i) => (
                <Link
                  key={c.id}
                  to={`/cluster/${c.id}`}
                  viewTransition
                  onMouseEnter={() => void fetchCluster(c.id)}
                  className={`card near-card tilt pos-${i}`}
                  data-tilt="4"
                  style={{ '--d': `${300 + i * 160}ms`, '--c': RISK_COLOR[c.risk_level] } as CSSProperties}
                >
                  <div className="near-top">
                    <h2 className="display d-sm" style={{ viewTransitionName: `ct-${c.id}` } as CSSProperties}>
                      {c.name}
                    </h2>
                    <RiskBadge level={c.risk_level} />
                  </div>
                  <div className="micro near-dist">
                    <Icon name="pin" size={14} draw={false} /> About <CountUp value={Math.max(10, Math.round(km / 10) * 10)} duration={1100} className="text" /> km ·{' '}
                    {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]} · {c.states.join(', ')}
                  </div>
                  <p style={{ margin: 0 }}>{plainHeadline(c.name, c.risk_level)}</p>
                </Link>
              ))}
              <div className="card near-sum pos-3" style={{ '--d': '780ms' } as CSSProperties}>
                <div className="micro">From {origin.label}</div>
                <dl>
                  <dt>Nearest cluster</dt>
                  <dd className="mono">{fmtInt(Math.max(10, Math.round(all[0].km / 10) * 10))} km</dd>
                  <dt>Clusters within 300 km</dt>
                  <dd className="mono">{all.filter((n) => n.km <= 300).length}</dd>
                  <dt>Clusters within 600 km</dt>
                  <dd className="mono">{all.filter((n) => n.km <= 600).length}</dd>
                  <dt>High-risk within 600 km</dt>
                  <dd className="mono">{all.filter((n) => n.km <= 600 && n.c.risk_level === 'high').length}</dd>
                </dl>
              </div>
            </div>
          </section>
        )}

        {closest && (
          <section className="card meaning reveal" aria-label="What this means for you">
            <RingsCityScene className="meaning-il" />
            <div>
              <div className="micro signal">What this means for you</div>
              <h2 className="display d-md" style={{ margin: '10px 0 14px' }}>
                {closest.c.name} is {closest.km < 20 ? 'right around you' : `about ${fmtInt(Math.max(10, Math.round(closest.km / 10) * 10))} km away`}.
              </h2>
              <ul className="meaning-list">
                <li>
                  <Icon name="scan" size={22} />
                  <span>
                    We measure NO₂ in a 20 km ring around each cluster. You are {closest.km <= 20 ? 'inside' : 'outside'} {closest.c.name}’s ring.
                  </span>
                </li>
                <li>
                  <Icon name="shield" size={22} />
                  <span>
                    Its rating is <b style={{ color: RISK_COLOR[closest.c.risk_level] }}>{RISK_LABEL[closest.c.risk_level].toLowerCase()}</b>. A high rating
                    means satellite readings are worth an official check, not that a rule was broken.
                  </span>
                </li>
                <li>
                  <Icon name="car" size={22} />
                  <span>Traffic, industry and burning near you also add NO₂. This tool looks only at whether coal plants match what they report.</span>
                </li>
              </ul>
              <div className="row" style={{ marginTop: 18 }}>
                <Link to={`/cluster/${closest.c.id}`} className="pill magnetic" viewTransition>
                  Open {closest.c.name} <span className="arrow" aria-hidden="true">→</span>
                </Link>
                <Link to="/limits" className="pill ghost" viewTransition>
                  What this cannot tell you
                </Link>
              </div>
            </div>
          </section>
        )}

        <p className="small muted" style={{ marginTop: 22 }}>
          We currently cover 11 of India’s largest coal plant areas, so the nearest one may still be far away. A high rating
          means something is worth checking, not that a rule was broken.
        </p>
        <Divider />
      </div>
    </div>
  )
}
