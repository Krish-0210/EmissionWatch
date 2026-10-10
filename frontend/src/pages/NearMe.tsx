import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { ClusterSummary, IndiaPlant, StateSummary } from '../api'
import { fetchCluster, fetchClusters, fetchPlantsIndia, fetchStates, peekClusters } from '../api'
import { RiskBadge } from '../components/Badges'
import Icon, { IconTile } from '../components/Icons'
import { RingsCityScene } from '../components/Illustrations'
import PageHero, { Divider, type TickerItem } from '../components/PageHero'
import { fmtInt, RISK_COLOR, RISK_LABEL } from '../lib/format'
import { bearingDeg, distanceKm } from '../lib/geo'
import { useAsync } from '../lib/useAsync'
import './nearme.css'

// Near Me: every coal plant of 500 MW or more (GEM, operating) by state or around the user's location.
// Plants in one of the analysed clusters show its risk and link to it; the others are listed with
// location and capacity only.

const RADIUS_KM = 250 // "Use my location" radius
const INDIA_CENTRE = { lat: 22.5, lon: 81.5 }
const UNANALYSED = '#6b7682'
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]
const roundKm = (km: number) => (km < 10 ? Math.max(1, Math.round(km)) : Math.round(km / 5) * 5)
// "Vindhyachal power station" -> "Vindhyachal" (radar labels)
const short = (name: string) => name.replace(/\s+(super\s+)?(thermal\s+)?(power\s+)?(station|plant|project|complex)\b.*$/i, '') || name

type Place = { kind: 'state'; state: StateSummary } | { kind: 'me'; lat: number; lon: number }
type Pt = { p: IndiaPlant; km: number; deg: number; c?: ClusterSummary }

function Radar({ pts, range, scanning, label = 3 }: { pts: Pt[]; range: number; scanning: boolean; label?: number }) {
  const pos = (n: Pt) => {
    const r = Math.min(96, (n.km / range) * 96), a = (n.deg * Math.PI) / 180
    return [Math.sin(a) * r, -Math.cos(a) * r]
  }
  // Label up to `label` of the largest plants, skipping any whose label would overlap one already placed.
  const labelled = new Set<string>()
  const placed: number[][] = []
  for (const n of [...pts].sort((a, b) => b.p.capacity_mw - a.p.capacity_mw)) {
    if (labelled.size >= label) break
    const [x, y] = pos(n)
    if (placed.some(([px, py]) => Math.abs(px - x) < 48 && Math.abs(py - y) < 10)) continue
    placed.push([x, y])
    labelled.add(n.p.id)
  }
  return (
    <div className={`radar${scanning ? ' scanning' : ''}`} aria-hidden="true">
      <svg viewBox="-100 -100 200 200">
        {[25, 50, 75, 98].map((r) => (
          <circle key={r} r={r} className="radar-ring" />
        ))}
        <line x1="-98" y1="0" x2="98" y2="0" className="radar-ring" />
        <line x1="0" y1="-98" x2="0" y2="98" className="radar-ring" />
        <text x="0" y="-90" className="radar-n" textAnchor="middle">N</text>
        <text x="90" y="3" className="radar-n" textAnchor="middle">E</text>
        <circle r="2.5" className="radar-me" />
        {pts.map((n, i) => {
          const [x, y] = pos(n)
          const big = labelled.has(n.p.id)
          return (
            <g
              key={n.p.id}
              transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
              className={`blip${big ? ' hot' : ''}${n.c ? ' analysed' : ''}`}
              style={{ '--d': `${150 + Math.min(i, 30) * 40}ms`, '--c': n.c ? RISK_COLOR[n.c.risk_level] : UNANALYSED } as CSSProperties}
            >
              {big && <circle r="9" className="blip-ring" />}
              <circle r={1.6 + Math.sqrt(n.p.capacity_mw / 1000) * 1.2} className="blip-dot" />
              {big && (
                <text x={x > 40 ? -6 : 6} y={-5} textAnchor={x > 40 ? 'end' : 'start'} className="blip-label">
                  {short(n.p.name).toUpperCase()}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="radar-sweep" />
      <div className="micro radar-scale">Outer ring ≈ {fmtInt(range >= 200 ? Math.round(range / 50) * 50 : Math.round(range / 10) * 10)} km</div>
    </div>
  )
}

function PlantRow({ n, showDistance }: { n: Pt; showDistance: boolean }) {
  const { p, c } = n
  return (
    <li className="plant-row" style={{ '--c': c ? RISK_COLOR[c.risk_level] : UNANALYSED } as CSSProperties}>
      <i className="plant-dot" aria-hidden="true" />
      <div className="plant-main">
        <div className="plant-name">{p.name}</div>
        <div className="micro">
          {fmtInt(p.capacity_mw)} MW{showDistance ? ` · ${fmtInt(roundKm(n.km))} km ${compass(n.deg)}` : ''}
          {!showDistance && ` · ${p.state}`}
        </div>
      </div>
      {c ? (
        <Link to={`/cluster/${c.id}`} className="plant-cluster" onMouseEnter={() => void fetchCluster(c.id)} viewTransition>
          <RiskBadge level={c.risk_level} />
          <span className="mono">{Math.round(c.risk_score)}/100</span>
          <span className="plant-open">
            {c.name} cluster <span aria-hidden="true">→</span>
          </span>
        </Link>
      ) : (
        <span className="plant-na micro">Not yet analysed by PanoptiCoal</span>
      )}
    </li>
  )
}

export default function NearMe() {
  const clusters = useAsync(fetchClusters, [], peekClusters)
  const plantsF = useAsync(fetchPlantsIndia, [])
  const statesF = useAsync(fetchStates, [])
  const [place, setPlace] = useState<Place>()
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string>()
  const error = clusters.error ?? plantsF.error ?? statesF.error
  const states = statesF.data?.states
  const byCluster = useMemo(() => new Map((clusters.data?.clusters ?? []).map((c) => [c.id, c])), [clusters.data])
  const plants = plantsF.data?.plants

  const pickState = (name: string) => {
    setGeoError(undefined)
    const s = states?.find((x) => x.name === name)
    setPlace(s ? { kind: 'state', state: s } : undefined)
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
        setPlace({ kind: 'me', lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      () => {
        setLocating(false)
        setGeoError('We could not get your location. Please pick your state instead.')
      },
      { timeout: 10000, maximumAge: 600000 },
    )
  }

  // Distances and bearings from the place (a state's centroid, the user, or the centre of India).
  const origin = place?.kind === 'state' ? place.state : place?.kind === 'me' ? place : INDIA_CENTRE
  const all: Pt[] = useMemo(
    () =>
      (plants ?? [])
        .map((p) => ({ p, km: distanceKm(origin.lat, origin.lon, p.lat, p.lon), deg: bearingDeg(origin.lat, origin.lon, p.lat, p.lon), c: p.cluster_id ? byCluster.get(p.cluster_id) : undefined }))
        .sort((a, b) => a.km - b.km),
    [plants, byCluster, origin.lat, origin.lon],
  )
  const inState = place?.kind === 'state' ? new Set(place.state.plant_ids) : null
  const shown = place?.kind === 'state' ? all.filter((n) => inState!.has(n.p.id)) : place?.kind === 'me' ? all.filter((n) => n.km <= RADIUS_KM) : all
  const nearest = all[0]
  const none = !!place && shown.length === 0
  // Radar scale: the state's extent (its plants), the 250 km search radius, or all of India.
  const range = !place
    ? Math.max(...all.map((n) => n.km), 300) * 1.04
    : place.kind === 'me'
      ? none && nearest ? nearest.km * 1.25 : RADIUS_KM
      : none && nearest ? nearest.km * 1.25 : Math.max(60, ...shown.map((n) => n.km)) * 1.15
  const radarPts = none && nearest ? [nearest] : shown
  // Analysed clusters among the shown plants, highest risk first.
  const hereClusters = [...new Set(shown.map((n) => n.c).filter((c): c is ClusterSummary => !!c))].sort((a, b) => b.risk_score - a.risk_score)
  const mw = shown.reduce((a, n) => a + n.p.capacity_mw, 0)
  const placeName = place?.kind === 'state' ? place.state.name : 'your location'
  // For "what this means": the analysed cluster closest to the user.
  const closestCluster =
    place?.kind === 'me' && clusters.data
      ? clusters.data.clusters.map((c) => ({ c, km: distanceKm(place.lat, place.lon, c.lat, c.lon) })).sort((a, b) => a.km - b.km)[0]
      : undefined

  const ticker: TickerItem[] = useMemo(() => {
    if (!plants || !states || !clusters.data) return []
    return [
      { label: 'Coal plants ≥ 500 MW', value: String(plants.length) },
      { label: 'Capacity', value: `${fmtInt(plants.reduce((a, p) => a + p.capacity_mw, 0))} MW` },
      { label: 'States with such a plant', value: String(states.filter((s) => s.plant_count > 0).length) },
      { label: 'Analysed clusters', value: `${clusters.data.clusters.length} · ${plants.filter((p) => p.cluster_id).length} plants` },
      { label: 'Data as of', value: clusters.data.as_of },
      { label: 'Your location', value: 'stays in your browser' },
    ]
  }, [plants, states, clusters.data])

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
        lede="Pick your state or share your location to see the large coal power plants there, and whether satellite readings match what they report."
        word="Near"
        visual={<Radar pts={radarPts} range={range} scanning={locating || !place} label={place ? 3 : 0} key={`${origin.lat},${origin.lon},${radarPts.length}`} />}
        ticker={ticker}
      >
        <div className="near-controls">
          <label htmlFor="state" className="sr-only">
            Choose your state
          </label>
          <select id="state" value={place?.kind === 'state' ? place.state.name : ''} onChange={(e) => pickState(e.target.value)} className="near-select" disabled={!states}>
            <option value="">Choose your state…</option>
            {states?.map((s) => (
              <option key={s.code} value={s.name}>
                {s.name} {s.plant_count ? `(${s.plant_count})` : ''}
              </option>
            ))}
          </select>
          <span className="micro">or</span>
          <button className="pill magnetic" onClick={locateMe} disabled={locating}>
            <Icon name="pin" size={18} draw={false} /> {locating ? 'Finding you…' : 'Use my location'}
          </button>
        </div>
        <p className="small muted near-privacy">Your location stays in your browser. It is not sent anywhere. Covers coal plants of 500 MW and above.</p>
        {geoError && (
          <div className="alert err" role="alert">
            {geoError}
          </div>
        )}
      </PageHero>

      <div className="container layer section-tight">
        {error && <div className="alert err">Could not load data: {error}</div>}

        {!place && plants && (
          <div className="near-empty-wrap">
            <div>
              <div className="near-empty reveal">
                <IconTile name="scan" />
                <p className="muted">
                  Pick your state or share your location above. Until then the radar shows all {plants.length} coal plants of 500 MW or
                  more, by distance and direction from the centre of India.
                </p>
              </div>
              <ol className="near-steps">
                {[
                  { icon: 'pin' as const, t: 'Choose where you are', b: 'A state, or your device location. Nothing leaves your browser.' },
                  { icon: 'scan' as const, t: 'See the plants there', b: `Every coal plant of 500 MW or more in your state, or within ${RADIUS_KM} km of you.` },
                  { icon: 'shield' as const, t: 'Read what it means', b: 'Plants in an analysed cluster show its risk level and link to the evidence.' },
                ].map((s, i) => (
                  <li key={s.t} className="card tilt reveal" style={{ '--d': `${i * 110}ms` } as CSSProperties}>
                    <IconTile name={s.icon} />
                    <span className="mono near-step-n">0{i + 1}</span>
                    <h3>{s.t}</h3>
                    <p className="muted small">{s.b}</p>
                  </li>
                ))}
              </ol>
            </div>
            <RingsCityScene className="near-empty-il reveal" label="A city inside measurement rings around a coal plant, with traffic on the road" />
          </div>
        )}

        {place && plants && (
          <section className="near-results" aria-live="polite" key={`${origin.lat},${origin.lon}`}>
            {none ? (
              <div className="near-none card">
                <IconTile name="pin" />
                <div>
                  <h2 className="display d-sm">
                    {place.kind === 'state'
                      ? `No large coal power plants (≥500 MW) found in ${place.state.name}.`
                      : `No large coal power plants (≥500 MW) within ${RADIUS_KM} km of you.`}
                  </h2>
                  {nearest && (
                    <p className="near-nearest">
                      Nearest: <b>{nearest.p.name}</b> ({nearest.p.state}), about {fmtInt(roundKm(nearest.km))} km {compass(nearest.deg)}
                      {place.kind === 'state' ? ` of the centre of ${place.state.name}` : ' of you'}
                      {nearest.c ? (
                        <>
                          {' '}
                          · in the{' '}
                          <Link to={`/cluster/${nearest.c.id}`} viewTransition>
                            {nearest.c.name} cluster
                          </Link>
                          , {RISK_LABEL[nearest.c.risk_level].toLowerCase()}.
                        </>
                      ) : (
                        '. Not yet analysed by PanoptiCoal.'
                      )}
                    </p>
                  )}
                  <p className="small muted" style={{ margin: 0 }}>
                    Smaller plants are not listed, so there may still be coal plants under 500 MW nearby.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="near-head">
                  <div className="micro">{place.kind === 'state' ? `Coal plants in ${placeName}` : `Coal plants within ${RADIUS_KM} km of you`}</div>
                  <h2 className="display d-md">
                    {shown.length} plant{shown.length === 1 ? '' : 's'} · {fmtInt(mw)} MW
                  </h2>
                  <p className="muted small">
                    {hereClusters.length
                      ? `${shown.filter((n) => n.c).length} of them are in ${hereClusters.length === 1 ? 'an analysed cluster' : `${hereClusters.length} analysed clusters`}; the rest are not yet analysed.`
                      : 'None of them is in one of the 11 clusters PanoptiCoal analyses yet; they are listed with location and capacity only.'}
                    {place.kind === 'me' && ' Distances are from your location.'}
                  </p>
                </div>
                {hereClusters.length > 0 && (
                  <div className="near-clusters spot-group">
                    {hereClusters.map((c) => (
                      <Link key={c.id} to={`/cluster/${c.id}`} className="card near-card tilt" data-tilt="4" viewTransition onMouseEnter={() => void fetchCluster(c.id)} style={{ '--c': RISK_COLOR[c.risk_level] } as CSSProperties}>
                        <div className="near-top">
                          <h3 className="display d-sm" style={{ viewTransitionName: `ct-${c.id}` } as CSSProperties}>
                            {c.name}
                          </h3>
                          <RiskBadge level={c.risk_level} />
                        </div>
                        <div className="near-score">
                          <span className="mono" style={{ color: RISK_COLOR[c.risk_level] }}>
                            {Math.round(c.risk_score)}
                          </span>
                          <span className="micro">/ 100 audit risk</span>
                        </div>
                        <p className="small muted" style={{ margin: 0 }}>
                          {shown.filter((n) => n.c?.id === c.id).length} of its plants {place.kind === 'state' ? `are in ${placeName}` : `are within ${RADIUS_KM} km`} · open the evidence →
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
                <ul className="plant-list">
                  {shown.map((n) => (
                    <PlantRow key={n.p.id} n={n} showDistance={place.kind === 'me'} />
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {closestCluster && (
          <section className="card meaning reveal" aria-label="What this means for you">
            <RingsCityScene className="meaning-il" />
            <div>
              <div className="micro signal">What this means for you</div>
              <h2 className="display d-md" style={{ margin: '10px 0 14px' }}>
                The nearest analysed cluster, {closestCluster.c.name}, is {closestCluster.km < 20 ? 'right around you' : `about ${fmtInt(roundKm(closestCluster.km))} km away`}.
              </h2>
              <ul className="meaning-list">
                <li>
                  <Icon name="scan" size={22} />
                  <span>
                    We measure NO₂ in a 20 km ring around each cluster. You are {closestCluster.km <= 20 ? 'inside' : 'outside'} {closestCluster.c.name}’s ring.
                  </span>
                </li>
                <li>
                  <Icon name="shield" size={22} />
                  <span>
                    Its rating is <b style={{ color: RISK_COLOR[closestCluster.c.risk_level] }}>{RISK_LABEL[closestCluster.c.risk_level].toLowerCase()}</b>. A high
                    rating means satellite readings are worth an official check, not that a rule was broken.
                  </span>
                </li>
                <li>
                  <Icon name="car" size={22} />
                  <span>Traffic, industry and burning near you also add NO₂. This tool looks only at whether coal plants match what they report.</span>
                </li>
              </ul>
              <div className="row" style={{ marginTop: 18 }}>
                <Link to={`/cluster/${closestCluster.c.id}`} className="pill magnetic" viewTransition>
                  Open {closestCluster.c.name} <span className="arrow" aria-hidden="true">→</span>
                </Link>
                <Link to="/limits" className="ulink" viewTransition>
                  What this cannot tell you <span className="arrow" aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          </section>
        )}

        <p className="small muted" style={{ marginTop: 22 }}>
          Covers coal plants of 500 MW and above (Global Energy Monitor, operating units). Plants in the 11 clusters PanoptiCoal analyses show
          that cluster’s risk; a high rating means something is worth checking, not that a rule was broken.
          {plantsF.data && <span className="near-credit"> {plantsF.data.boundaries}.</span>}
        </p>
        <Divider />
      </div>
    </div>
  )
}
