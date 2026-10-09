import { memo, type CSSProperties } from 'react'
import type { ClusterSummary } from '../api'
import { RISK_COLOR } from '../lib/format'
import { INDIA_OUTLINE } from '../lib/india'

// Risk Map hero: India's outline tilted away in perspective, with a light beacon rising from each
// cluster at its true coordinates. Beacon height = audit risk score, colour = risk level; the base
// ring pulses faster for higher risk. A satellite crosses above. Ranked labels on the right.

const W = 460, H = 320
const MAPW = 300 // map area; labels to the right
const TILT = (52 * Math.PI) / 180 // camera elevation above the ground plane
const D = 3.1 // camera distance
const F = 440 // focal length (px)
const CX = MAPW / 2 - 4, CY = H * 0.55

// Ground plane: X east, Z north (both ~[-1, 1] over India), Y up.
const ground = (lon: number, lat: number) => [(lon - 82.5) / 15, (lat - 21.5) / 15] as const
function project(X: number, Y: number, Z: number) {
  const s = Math.sin(TILT), c = Math.cos(TILT)
  const yv = Y * c + Z * s
  const zv = -Y * s + Z * c + D
  return { x: CX + (F * X) / zv, y: CY - (F * yv) / zv, k: F / zv }
}
const at = (lon: number, lat: number, y = 0) => {
  const [X, Z] = ground(lon, lat)
  return project(X, y, Z)
}

const OUTLINE = INDIA_OUTLINE.map(([lon, lat]) => at(lon, lat))
  .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
  .join('') + 'Z'
const GRID = [
  ...[70, 75, 80, 85, 90, 95].map((lon) => [at(lon, 6), at(lon, 37)]),
  ...[10, 15, 20, 25, 30, 35].map((lat) => [at(68, lat), at(98, lat)]),
].map(([a, b]) => `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`)
const SAT = `M${-20} ${H * 0.2} Q ${MAPW / 2} ${-30} ${MAPW + 40} ${H * 0.34}`

const RiskBeacons = memo(function RiskBeacons({ clusters }: { clusters: ClusterSummary[] }) {
  // Far (north) beacons drawn first so near ones overlap them.
  const nodes = clusters
    .map((c) => {
      const base = at(c.lon, c.lat)
      const h = 0.12 + 0.62 * (c.risk_score / 100)
      const top = at(c.lon, c.lat, h)
      return { c, base, top, len: base.y - top.y }
    })
    .sort((a, b) => a.base.y - b.base.y)
  const ranked = [...nodes].sort((a, b) => b.c.risk_score - a.c.risk_score)
  const rank = new Map(ranked.map((n, i) => [n.c.id, i]))
  const step = (H - 24) / ranked.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="beacons" role="img" aria-label="India tilted in perspective with a light beacon rising from each of the 11 clusters; taller and redder means a higher audit risk score">
      <defs>
        <linearGradient id="rb-land" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7ce8d8" stopOpacity="0.03" />
          <stop offset="1" stopColor="#7ce8d8" stopOpacity="0.12" />
        </linearGradient>
        {(['low', 'medium', 'high'] as const).map((l) => (
          <linearGradient key={l} id={`rb-beam-${l}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={RISK_COLOR[l]} stopOpacity="0.95" />
            <stop offset="0.7" stopColor={RISK_COLOR[l]} stopOpacity="0.35" />
            <stop offset="1" stopColor={RISK_COLOR[l]} stopOpacity="0" />
          </linearGradient>
        ))}
        <clipPath id="rb-mapclip">
          <rect x="0" y="0" width={MAPW} height={H} />
        </clipPath>
      </defs>
      <g className="rb-grid" clipPath="url(#rb-mapclip)">
        {GRID.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <path d={OUTLINE} className="rb-india" />
      <path d={SAT} className="rb-orbit" />
      <g className="rb-sat">
        <circle r="2.6" />
        <circle r="7" className="halo" />
        <animateMotion dur="9s" repeatCount="indefinite" path={SAT} />
      </g>
      {nodes.map(({ c, base, top, len }) => {
        const r = rank.get(c.id) ?? 0
        const ly = 12 + step * (r + 0.5)
        const rx = 7 + c.risk_score / 12
        return (
          <g
            key={c.id}
            className={`rb-node ${c.risk_level}`}
            style={{ '--c': RISK_COLOR[c.risk_level], '--d': `${0.25 + r * 0.09}s`, '--len': `${len.toFixed(1)}px` } as CSSProperties}
          >
            <path d={`M${top.x.toFixed(1)} ${top.y.toFixed(1)} L${MAPW + 4} ${ly.toFixed(1)} H${MAPW + 10}`} className="rb-leader" />
            <ellipse cx={base.x} cy={base.y} rx={rx} ry={rx * Math.sin(TILT)} className="rb-pulse" />
            <ellipse cx={base.x} cy={base.y} rx={3.2} ry={3.2 * Math.sin(TILT)} className="rb-base" />
            <g className="rb-rise" style={{ transformOrigin: `${base.x.toFixed(1)}px ${base.y.toFixed(1)}px` }}>
              <rect x={base.x - 1.6} y={top.y} width={3.2} height={len} rx={1.6} fill={`url(#rb-beam-${c.risk_level})`} />
              <circle cx={base.x} cy={base.y} r={1.6} className="rb-spark" />
              <circle cx={top.x} cy={top.y + 3} r={2.4} className="rb-tip" />
            </g>
            <text x={MAPW + 14} y={ly + 3} className="rb-label">
              {c.name.toUpperCase()}
            </text>
            <text x={W - 2} y={ly + 3} className="rb-score" textAnchor="end">
              {Math.round(c.risk_score)}
            </text>
          </g>
        )
      })}
    </svg>
  )
})

export default RiskBeacons
