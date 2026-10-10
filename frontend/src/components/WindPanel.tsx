import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { ClusterSummary, WindTrace } from '../api'
import { fetchWind } from '../api'
import { fmtInt, RISK_COLOR } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import '../styles/wind.css'

// Where a cluster's plume is likely heading: the wind cone (bearing ± 30°, 75 km), an arrow from the
// centroid along the bearing, the 20 km measurement ring and the towns in the cone, with the API's
// sentence, a Live / ERA5 badge and the attribution. Direction only: no concentrations or exposure.

const R = 6371
// Point `km` from (lat, lon) along `deg` (0 = north, clockwise).
function along(lat: number, lon: number, deg: number, km: number): [number, number] {
  const r = Math.PI / 180, d = km / R, t = deg * r, p1 = lat * r, l1 = lon * r
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t))
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return [p2 / r, l2 / r]
}

const arrowHead = (deg: number) =>
  L.divIcon({
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<svg class="wind-head" viewBox="-11 -11 22 22" style="transform: rotate(${deg}deg)"><path d="M0 -9 L7 6 L0 2 L-7 6 Z"/></svg>`,
  })

function Recenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lon], map.getZoom(), { animate: true })
  }, [map, lat, lon])
  return null
}

const asOf = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }) + ' IST'
}

function WindMap({ c, w }: { c: ClusterSummary; w: WindTrace }) {
  const cone = useMemo(() => w.cone_polygon.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]), [w])
  const tip = along(c.lat, c.lon, w.bearing_deg, 52)
  const head = useMemo(() => arrowHead(w.bearing_deg), [w.bearing_deg])
  return (
    // An illustration of the sentence below it: shapes are not interactive and the map takes no keyboard focus.
    <MapContainer center={[c.lat, c.lon]} zoom={8} minZoom={6} maxZoom={11} scrollWheelZoom={false} keyboard={false} className="wind-map">
      <TileLayer
        attribution='Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxZoom={16}
      />
      <Recenter lat={c.lat} lon={c.lon} />
      <Polygon positions={cone} interactive={false} pathOptions={{ color: '#ff8a3d', weight: 1, opacity: 0.7, fillColor: '#ff8a3d', fillOpacity: 0.16 }} />
      <Circle center={[c.lat, c.lon]} radius={20000} interactive={false} pathOptions={{ color: '#7ce8d8', weight: 1, opacity: 0.6, dashArray: '4 6', fill: false }} />
      <Polyline positions={[[c.lat, c.lon], tip]} interactive={false} pathOptions={{ color: '#ffc29a', weight: 2.5, opacity: 0.95 }} />
      <Marker position={tip} icon={head} interactive={false} keyboard={false} />
      <CircleMarker center={[c.lat, c.lon]} radius={6} interactive={false} pathOptions={{ color: '#07090c', weight: 2, fillColor: RISK_COLOR[c.risk_level], fillOpacity: 1 }}>
        <Tooltip permanent direction="left" offset={[-8, 0]} className="wind-tip">
          {c.name} cluster
        </Tooltip>
      </CircleMarker>
      {w.towns_in_path.map((t) => (
        <CircleMarker key={t.name} center={[t.lat, t.lon]} radius={3.5} interactive={false} pathOptions={{ color: '#e8edf2', weight: 1, fillColor: '#e8edf2', fillOpacity: 0.9 }}>
          <Tooltip permanent direction="right" offset={[6, 0]} className="wind-town">
            {t.name}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}

export default function WindPanel({ clusters, id, onChange, title = 'Where the plume is heading' }: { clusters: ClusterSummary[]; id: string; onChange?: (id: string) => void; title?: string }) {
  const c = clusters.find((x) => x.id === id) ?? clusters[0]
  const wind = useAsync(() => (c ? fetchWind(c.id) : Promise.resolve(undefined)), [c?.id])
  if (!c) return null
  const w = wind.data
  return (
    <section className="wind-panel card" aria-label={`${title}: ${c.name}`}>
      <div className="wind-head-row">
        <div>
          <div className="micro signal">Wind trace</div>
          <h3>{title}</h3>
        </div>
        {clusters.length > 1 && onChange && (
          <label className="wind-pick">
            <span className="sr-only">Cluster</span>
            <select className="wind-select" value={c.id} onChange={(e) => onChange(e.target.value)}>
              {clusters.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {wind.error && <div className="alert err">Could not load the wind for {c.name}: {wind.error}</div>}
      {w && (
        <>
          <div className="wind-map-box" role="img" aria-label={w.sentence}>
            <WindMap c={c} w={w} />
          </div>
          <div className="wind-meta">
            <span className={`wind-src ${w.source}`}>{w.source === 'live' ? 'Live wind' : 'ERA5 reanalysis, not current'}</span>
            <span className="micro">
              {fmtInt(w.speed_kmh)} km/h · {asOf(w.as_of)}
            </span>
          </div>
          <p className="wind-sentence">{w.sentence}</p>
          <p className="wind-attr">{w.attribution} Cone: wind direction ± 30°, 75 km; dashed ring: the 20 km measurement ring.</p>
        </>
      )}
      {!w && !wind.error && <div className="wind-map-box wind-skel" aria-hidden="true" />}
    </section>
  )
}
