import type { MonthPoint } from '../api'
import { easeOut, span } from '../lib/motion'
import { METHOD_AT } from '../lib/story'

// One SVG scene that rebuilds the method as `p` (0..1) advances through six steps.
// Scale: 3 px per km around the cluster centre (400, 250).
const CX = 400, CY = 250, KM = 3


interface Props {
  p: number
  residuals?: MonthPoint[]
  score?: number
  scoreColor?: string
  clusterName?: string
}

function circleDash(r: number, k: number) {
  const c = 2 * Math.PI * r
  return { strokeDasharray: c, strokeDashoffset: c * (1 - k) }
}

export default function MethodScene({ p, residuals = [], score = 0, scoreColor = '#ff5a3c', clusterName = '' }: Props) {
  const k = METHOD_AT.map((a, i) => easeOut(span(p, a, (METHOD_AT[i + 1] ?? 0.97) - 0.02)))
  const [kPlant, kRings, kBg, kWx, kRes, kScore] = k
  // Earlier layers recede once residuals and score take over.
  const recede = 1 - 0.75 * span(p, METHOD_AT[4], METHOD_AT[4] + 0.08)
  const res = residuals.filter((m) => m.residual != null)
  const maxAbs = Math.max(1, ...res.map((m) => Math.abs(m.residual!)))
  const r = 120, len = 2 * Math.PI * r

  return (
    <svg viewBox="0 0 800 500" className="method-scene" role="img" aria-label="Diagram of the method: plant cluster, 10 and 20 km rings, background annulus, weather and season, residuals, risk score">
      <defs>
        <radialGradient id="ms-plume" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff8a3d" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ff8a3d" stopOpacity="0" />
        </radialGradient>
        <pattern id="ms-dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1" fill="#7ce8d8" opacity="0.5" />
        </pattern>
        <mask id="ms-annulus">
          <circle cx={CX} cy={CY} r={80 * KM} fill="white" />
          <circle cx={CX} cy={CY} r={50 * KM} fill="black" />
        </mask>
        <marker id="ms-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#8a96a3" />
        </marker>
      </defs>

      <g opacity={recede}>
        {/* 03 background annulus 50–80 km */}
        <g opacity={kBg}>
          <rect x="0" y="0" width="800" height="500" fill="url(#ms-dots)" mask="url(#ms-annulus)" />
          <circle cx={CX} cy={CY} r={50 * KM} fill="none" stroke="#7ce8d8" strokeOpacity="0.5" strokeDasharray="3 5" />
          <circle cx={CX} cy={CY} r={80 * KM} fill="none" stroke="#7ce8d8" strokeOpacity="0.5" strokeDasharray="3 5" />
          <text x={CX + 80 * KM * 0.71 + 8} y={CY - 80 * KM * 0.71} className="ms-label">50–80 KM BACKGROUND</text>
          <text x={CX} y={CY + 80 * KM + 4} className="ms-label" textAnchor="middle" opacity={span(p, METHOD_AT[2] + 0.06, METHOD_AT[3])}>
            RING − BACKGROUND = ENHANCEMENT
          </text>
        </g>

        {/* 02 rings */}
        <circle cx={CX} cy={CY} r={20 * KM} fill="rgba(255,138,61,0.08)" opacity={kRings} />
        <circle cx={CX} cy={CY} r={10 * KM} fill="none" stroke="#7ce8d8" strokeWidth="1.5" transform={`rotate(-90 ${CX} ${CY})`} style={circleDash(10 * KM, kRings)} />
        <circle cx={CX} cy={CY} r={20 * KM} fill="none" stroke="#7ce8d8" strokeWidth="1.5" transform={`rotate(-90 ${CX} ${CY})`} style={circleDash(20 * KM, span(kRings, 0.2, 1))} />
        <text x={CX + 20 * KM + 8} y={CY + 4} className="ms-label" opacity={kRings}>20 KM</text>
        <text x={CX + 10 * KM + 6} y={CY - 10 * KM + 2} className="ms-label" opacity={kRings}>10 KM</text>

        {/* 01 plant + plume */}
        <g opacity={kPlant} transform={`translate(${CX} ${CY}) scale(${0.6 + 0.4 * kPlant})`}>
          <circle r="42" fill="url(#ms-plume)" className="ms-plume" />
          <rect x="-16" y="-2" width="32" height="14" rx="1" fill="#1c232b" stroke="#8a96a3" strokeWidth="0.8" />
          <rect x="-12" y="-20" width="5" height="20" fill="#1c232b" stroke="#8a96a3" strokeWidth="0.8" />
          <rect x="4" y="-26" width="5" height="26" fill="#1c232b" stroke="#8a96a3" strokeWidth="0.8" />
          <circle cx="6.5" cy="-32" r="4" fill="#ff8a3d" className="ms-puff" />
          <circle cx="-9.5" cy="-26" r="3" fill="#ff8a3d" className="ms-puff d2" />
        </g>

        {/* 04 weather + season */}
        <g opacity={kWx}>
          {[90, 170, 330, 410].map((y, i) => (
            <line key={y} x1={40 + (i % 2) * 30} y1={y} x2={150 + (i % 2) * 30} y2={y - 14} className="ms-wind" markerEnd="url(#ms-arrow)" style={{ animationDelay: `${i * 0.4}s` }} />
          ))}
          <text x="40" y="60" className="ms-label">WIND · ERA5</text>
          <g transform="translate(600 410)">
            <text x="0" y="-34" className="ms-label">SEASON</text>
            <path d={Array.from({ length: 41 }, (_, i) => `${i ? 'L' : 'M'}${i * 4},${-Math.sin((i / 40) * Math.PI * 2) * 16}`).join('')} fill="none" stroke="#8a96a3" strokeWidth="1.2" style={{ strokeDasharray: 200, strokeDashoffset: 200 * (1 - kWx) }} />
          </g>
          <g transform="translate(620 80)">
            <text x="0" y="0" className="ms-label">MIXING LAYER</text>
            {[0, 1, 2].map((i) => (
              <rect key={i} x={i * 22} y={14} width="14" height={20 + i * 14} fill="none" stroke="#8a96a3" strokeWidth="1" opacity={span(kWx, i * 0.2, i * 0.2 + 0.5)} />
            ))}
          </g>
        </g>
      </g>

      {/* 05 residuals: real monthly residuals of the focus cluster */}
      {res.length > 0 && (
        <g opacity={kRes * (1 - 0.7 * kScore)} transform="translate(80 250)">
          <text x="0" y="-110" className="ms-label">RESIDUAL · OBSERVED − EXPECTED · {clusterName.toUpperCase()} · MONTHLY</text>
          <line x1="0" x2="640" y1="0" y2="0" stroke="#2a333d" />
          {res.map((m, i) => {
            const h = (m.residual! / maxAbs) * 90 * span(kRes, (i / res.length) * 0.6, (i / res.length) * 0.6 + 0.4)
            return <rect key={m.month} x={(i / res.length) * 640} y={h > 0 ? -h : 0} width={Math.max(1.5, 640 / res.length - 2)} height={Math.abs(h)} fill={h > 0 ? '#ff8a3d' : '#7ce8d8'} opacity={0.85} rx="1" />
          })}
        </g>
      )}

      {/* 06 score */}
      <g opacity={kScore} transform={`translate(${CX} ${CY})`}>
        <circle r={r} fill="rgba(7,9,12,0.85)" stroke="#1c232b" strokeWidth="6" />
        <circle r={r} fill="none" stroke={scoreColor} strokeWidth="6" strokeLinecap="round" transform="rotate(-90)" strokeDasharray={len} strokeDashoffset={len * (1 - (score / 100) * kScore)} style={{ filter: `drop-shadow(0 0 8px ${scoreColor})` }} />
        <text y="12" textAnchor="middle" className="ms-score">{String(Math.round(score * kScore)).padStart(3, '0')}</text>
        <text y="44" textAnchor="middle" className="ms-label">{clusterName.toUpperCase()} · AUDIT RISK</text>
      </g>
    </svg>
  )
}
