import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { ClusterSummary } from '../api'
import { RISK_LABEL } from '../lib/format'

interface Props {
  clusters: ClusterSummary[]
  highlight?: string
  dimmed?: Set<string>
  onHover?: (id: string | undefined) => void
  onSelect: (id: string) => void
  flyTo?: ClusterSummary
  onArrive?: () => void
}

function icon(c: ClusterSummary, hl: boolean, dim: boolean) {
  const size = Math.round(18 + Math.sqrt(c.capacity_mw) / 3.2)
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="mk mk-${c.risk_level}${hl ? ' hl' : ''}${dim ? ' dim' : ''}" style="--s:${size}px"><i></i><i></i><b></b></span>`,
  })
}

function Flyer({ target, onArrive }: { target?: ClusterSummary; onArrive?: () => void }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.lat, target.lon], 9, { duration: 1.1 })
    const id = setTimeout(() => onArrive?.(), 1200)
    return () => clearTimeout(id)
  }, [map, target, onArrive])
  return null
}

export default function ClusterMap({ clusters, highlight, dimmed, onHover, onSelect, flyTo, onArrive }: Props) {
  const icons = useMemo(
    () => Object.fromEntries(clusters.map((c) => [c.id, { off: icon(c, false, false), on: icon(c, true, false), dim: icon(c, false, true) }])),
    [clusters],
  )
  return (
    <MapContainer center={[22.5, 81]} zoom={5} minZoom={4} maxZoom={11} scrollWheelZoom={false}>
      {/* CARTO dark_matter now needs an API key; Esri Dark Gray Canvas is a keyless dark basemap. */}
      <TileLayer
        attribution='Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        maxZoom={16}
      />
      {clusters.map((c) => (
        <Marker
          key={c.id}
          position={[c.lat, c.lon]}
          icon={highlight === c.id ? icons[c.id].on : dimmed?.has(c.id) ? icons[c.id].dim : icons[c.id].off}
          title={`${c.name}: ${RISK_LABEL[c.risk_level]}, score ${Math.round(c.risk_score)}`}
          alt={c.name}
          riseOnHover
          eventHandlers={{
            click: () => onSelect(c.id),
            mouseover: () => onHover?.(c.id),
            mouseout: () => onHover?.(undefined),
            keypress: (e) => {
              const k = (e.originalEvent as KeyboardEvent).key
              if (k === 'Enter' || k === ' ') onSelect(c.id)
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -12]} className="mk-tip">
            <span className="mono">{c.name.toUpperCase()}</span> · {RISK_LABEL[c.risk_level]} · {Math.round(c.risk_score)}/100
          </Tooltip>
        </Marker>
      ))}
      <Flyer target={flyTo} onArrive={onArrive} />
    </MapContainer>
  )
}
