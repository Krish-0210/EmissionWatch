import 'leaflet/dist/leaflet.css'
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import type { ClusterSummary } from '../api'
import { RISK_COLOR, RISK_LABEL } from '../lib/format'

interface Props {
  clusters: ClusterSummary[]
  highlight?: string
  onHover?: (id: string | undefined) => void
}

export default function ClusterMap({ clusters, highlight, onHover }: Props) {
  const navigate = useNavigate()
  return (
    <MapContainer center={[22.5, 81]} zoom={5} minZoom={4} scrollWheelZoom={false} aria-label="Map of coal plant clusters">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {clusters.map((c) => (
        <CircleMarker
          key={c.id}
          center={[c.lat, c.lon]}
          radius={8 + Math.sqrt(c.capacity_mw) / 12}
          pathOptions={{
            color: highlight === c.id ? '#16181d' : '#ffffff',
            weight: highlight === c.id ? 3 : 2,
            fillColor: RISK_COLOR[c.risk_level],
            fillOpacity: 0.85,
          }}
          eventHandlers={{
            click: () => navigate(`/cluster/${c.id}`),
            mouseover: () => onHover?.(c.id),
            mouseout: () => onHover?.(undefined),
          }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <strong>{c.name}</strong> · {RISK_LABEL[c.risk_level]} · {Math.round(c.risk_score)}/100
            <br />
            {c.capacity_mw.toLocaleString('en-IN')} MW · click for details
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
