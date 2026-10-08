import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { ClusterSummary } from '../api'
import { fetchClusters } from '../api'
import { RiskBadge } from '../components/Badges'
import BigWord from '../components/BigWord'
import CountUp from '../components/CountUp'
import { plainHeadline, RISK_COLOR } from '../lib/format'
import { bearingDeg, distanceKm, STATE_CENTRES } from '../lib/geo'
import { useAsync } from '../lib/useAsync'
import './nearme.css'

type Origin = { lat: number; lon: number; label: string }
type Near = { c: ClusterSummary; km: number; deg: number }

function Radar({ scanning, near, origin }: { scanning: boolean; near: Near[]; origin?: Origin }) {
  const maxKm = Math.max(300, ...near.map((n) => n.km)) * 1.15
  return (
    <div className={`radar${scanning ? ' scanning' : ''}`} aria-hidden="true">
      <svg viewBox="-100 -100 200 200">
        {[25, 50, 75, 98].map((r) => (
          <circle key={r} r={r} className="radar-ring" />
        ))}
        <line x1="-98" y1="0" x2="98" y2="0" className="radar-ring" />
        <line x1="0" y1="-98" x2="0" y2="98" className="radar-ring" />
        <circle r="2.5" className="radar-me" />
        {origin &&
          near.map((n, i) => {
            const r = (n.km / maxKm) * 96
            const a = (n.deg * Math.PI) / 180
            return (
              <g key={n.c.id} transform={`translate(${Math.sin(a) * r} ${-Math.cos(a) * r})`} className="blip" style={{ '--d': `${300 + i * 260}ms`, '--c': RISK_COLOR[n.c.risk_level] } as CSSProperties}>
                <circle r="9" className="blip-ring" />
                <circle r="3.4" className="blip-dot" />
              </g>
            )
          })}
      </svg>
      <div className="radar-sweep" />
      {origin && <div className="micro radar-scale">Outer ring ≈ {Math.round(maxKm / 50) * 50} km</div>}
    </div>
  )
}

export default function NearMe() {
  const { data, error } = useAsync(fetchClusters, [])
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

  const nearest: Near[] =
    data && origin
      ? data.clusters
          .map((c) => ({ c, km: distanceKm(origin.lat, origin.lon, c.lat, c.lon), deg: bearingDeg(origin.lat, origin.lon, c.lat, c.lon) }))
          .sort((a, b) => a.km - b.km)
          .slice(0, 3)
      : []

  return (
    <div className="section-tight nearme-page">
      <BigWord style={{ top: '0.08em', right: '-0.05em' }}>Near</BigWord>
      <div className="container layer nearme">
        <div className="micro signal reveal">Near me</div>
        <h1 className="display d-lg reveal" style={{ '--d': '80ms', margin: '14px 0 18px' } as CSSProperties}>
          Coal plants <span className="dim">near you.</span>
        </h1>
        <p className="lede reveal" style={{ '--d': '160ms' } as CSSProperties}>
          See the large coal power plant areas closest to you, and whether satellite readings match what they report.
        </p>

        <div className="nearme-grid">
          <div className="card reveal controls" style={{ '--d': '200ms' } as CSSProperties}>
            <label htmlFor="state" className="micro">
              Choose your state
            </label>
            <select id="state" value={state} onChange={(e) => pickState(e.target.value)}>
              <option value="">Select a state…</option>
              {Object.keys(STATE_CENTRES).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="or micro">or</div>
            <button className="pill ghost wide" onClick={locateMe} disabled={locating}>
              {locating ? 'Finding you…' : 'Use my location'}
            </button>
            <p className="small muted" style={{ margin: '12px 0 0' }}>
              Your location stays in your browser. It is not sent anywhere.
            </p>
            {geoError && (
              <div className="alert err" style={{ marginTop: 12 }} role="alert">
                {geoError}
              </div>
            )}
          </div>
          <div className="reveal" style={{ '--d': '260ms' } as CSSProperties}>
            <Radar scanning={locating || !origin} near={nearest} origin={origin} key={origin ? `${origin.lat},${origin.lon}` : 'none'} />
          </div>
        </div>

        {error && <div className="alert err" style={{ marginTop: 16 }}>Could not load data: {error}</div>}

        {origin && data && (
          <section className="near-results" aria-live="polite" key={`${origin.lat},${origin.lon}`}>
            <div className="micro" style={{ marginBottom: 14 }}>
              Closest to <span className="text">{origin.label}</span>
            </div>
            <div className="grid">
              {nearest.map(({ c, km }, i) => (
                <Link key={c.id} to={`/cluster/${c.id}`} className="card near-card" style={{ '--d': `${700 + i * 160}ms` } as CSSProperties}>
                  <div className="near-top">
                    <h2 className="display d-sm">{c.name}</h2>
                    <RiskBadge level={c.risk_level} />
                  </div>
                  <div className="micro near-dist">
                    About <CountUp value={Math.max(10, Math.round(km / 10) * 10)} duration={1100} className="text" /> km away · {c.states.join(', ')}
                  </div>
                  <p style={{ margin: 0 }}>{plainHeadline(c.name, c.risk_level)}</p>
                </Link>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 18 }}>
              We currently cover 11 of India’s largest coal plant areas, so the nearest one may still be far away. A high
              rating means something is worth checking, not that a rule was broken.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
