import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchClusters } from '../api'
import { RiskBadge } from '../components/Badges'
import { plainHeadline } from '../lib/format'
import { distanceKm, STATE_CENTRES } from '../lib/geo'
import { useAsync } from '../lib/useAsync'

type Origin = { lat: number; lon: number; label: string }

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

  const nearest =
    data && origin
      ? data.clusters
          .map((c) => ({ c, km: distanceKm(origin.lat, origin.lon, c.lat, c.lon) }))
          .sort((a, b) => a.km - b.km)
          .slice(0, 3)
      : []

  return (
    <div className="container section">
      <div className="nearme">
        <h1>Coal plants near me</h1>
        <p className="lede">
          See the large coal power plant areas closest to you, and whether satellite readings match what they report.
        </p>

        <div className="card">
          <label htmlFor="state">Choose your state</label>
          <select id="state" value={state} onChange={(e) => pickState(e.target.value)}>
            <option value="">Select a state…</option>
            {Object.keys(STATE_CENTRES).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="or">or</div>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={locateMe} disabled={locating}>
            {locating ? 'Finding you…' : 'Use my location'}
          </button>
          <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Your location stays in your browser. It is not sent anywhere.
          </p>
          {geoError && (
            <div className="alert err" style={{ marginTop: 12 }} role="alert">
              {geoError}
            </div>
          )}
        </div>

        {error && <div className="alert err" style={{ marginTop: 16 }}>Could not load data: {error}</div>}

        {origin && data && (
          <section style={{ marginTop: 32 }} aria-live="polite">
            <h2 style={{ fontSize: '1.3rem' }}>Closest to {origin.label}</h2>
            <div className="grid">
              {nearest.map(({ c, km }) => (
                <Link key={c.id} to={`/cluster/${c.id}`} className="card near-card">
                  <div className="row">
                    <h3 style={{ margin: 0 }}>{c.name}</h3>
                    <RiskBadge level={c.risk_level} />
                  </div>
                  <p className="small muted" style={{ marginBottom: 8 }}>
                    About {Math.round(km / 10) * 10 || '<10'} km away · {c.states.join(', ')}
                  </p>
                  <p style={{ marginBottom: 0 }}>{plainHeadline(c.name, c.risk_level)}</p>
                </Link>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 16 }}>
              We currently cover 11 of India’s largest coal plant areas, so the nearest one may still be far away. A high
              rating means something is worth checking, not that a rule was broken.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
