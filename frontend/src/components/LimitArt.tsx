import type { CSSProperties } from 'react'

// Small looping illustrations, one per limit (decorative; the card text carries the meaning).
const d = (s: number) => ({ '--d': `${s}s` }) as CSSProperties

function Pixels() {
  return (
    <svg viewBox="0 0 160 100" className="la">
      {Array.from({ length: 24 }, (_, i) => {
        const c = i % 6, r = Math.floor(i / 6)
        const lit = (c === 2 || c === 3) && r === 1
        return <rect key={i} x={8 + c * 24} y={6 + r * 22} width={24} height={22} className={`la-cell${lit ? ' lit' : ''}`} style={d(((c + r) % 6) * 0.25)} />
      })}
      <circle cx="62" cy="34" r="3.5" className="la-plant" />
      <circle cx="76" cy="40" r="3.5" className="la-plant" />
      <circle cx="98" cy="36" r="3.5" className="la-plant" />
      <text x="80" y="96" textAnchor="middle" className="la-cap">3 PLANTS · 2 PIXELS</text>
    </svg>
  )
}

function Clouds() {
  return (
    <svg viewBox="0 0 160 100" className="la">
      <g transform="translate(80 10)">
        <rect x="-6" y="-4" width="12" height="8" rx="1.5" className="la-sat" />
        <rect x="-22" y="-2" width="14" height="4" className="la-panel" />
        <rect x="8" y="-2" width="14" height="4" className="la-panel" />
      </g>
      <path d="M80 16 L56 84 H104 Z" className="la-beam" />
      <g className="la-cloud">
        <path d="M30 52 h44 a10 10 0 0 0 0 -20 a14 14 0 0 0 -26 -4 a11 11 0 0 0 -18 24 z" />
      </g>
      <path d="M20 86 H140" className="la-ground" />
      <text x="80" y="98" textAnchor="middle" className="la-cap">NO VALID PIXEL</text>
    </svg>
  )
}

function Sources() {
  return (
    <svg viewBox="0 0 160 100" className="la">
      <path d="M8 80 H152" className="la-ground" />
      <g className="la-car">
        <rect x="-18" y="70" width="16" height="7" rx="2" />
        <circle cx="-3" cy="73.5" r="1.4" className="lamp" />
      </g>
      <path d="M96 80 V60 L108 54 V60 L120 54 V80 Z M124 80 V44 H130 V80 Z" className="la-fac" />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx="127" cy="40" r="3.5" className="la-puff" style={d(i * 0.9)} />
      ))}
      <path d="M40 80 c-4 -6 2 -10 0 -16 c6 4 8 10 4 16 z" className="la-fire" />
      {[0, 1].map((i) => (
        <circle key={i} cx="44" cy="60" r="3" className="la-puff grey" style={d(0.4 + i * 1.2)} />
      ))}
      <text x="80" y="96" textAnchor="middle" className="la-cap">TRAFFIC · INDUSTRY · BURNING</text>
    </svg>
  )
}

function Missing() {
  return (
    <svg viewBox="0 0 160 100" className="la">
      <circle cx="80" cy="50" r="40" className="la-ring" />
      <path d="M44 72 V58 L54 53 V58 L64 53 V72 Z M66 72 V44 H71 V72 Z" className="la-fac" />
      <path d="M94 72 V56 L104 51 V56 L114 51 V72 Z M116 72 V42 H121 V72 Z" className="la-ghost" />
      <text x="107" y="38" textAnchor="middle" className="la-q">?</text>
      <text x="80" y="98" textAnchor="middle" className="la-cap">CAPTIVE PLANT · NOT IN CEA</text>
    </svg>
  )
}

function Sustained() {
  const pts = Array.from({ length: 48 }, (_, i) => `${6 + i * 3.1},${50 + Math.sin(i * 1.7) * 14 + Math.sin(i * 0.35) * 6 - (i > 30 ? (i - 30) * 0.9 : 0)}`)
  return (
    <svg viewBox="0 0 160 100" className="la">
      <rect x="0" y="16" width="42" height="64" className="la-window" />
      <polyline points={pts.join(' ')} className="la-noise" />
      <path d="M6 52 H154" className="la-zero" />
      <text x="80" y="96" textAnchor="middle" className="la-cap">90-DAY WINDOW, NOT ONE DAY</text>
    </svg>
  )
}

function Area() {
  return (
    <svg viewBox="0 0 160 100" className="la">
      <ellipse cx="80" cy="62" rx="64" ry="20" className="la-area" />
      <ellipse cx="80" cy="62" rx="64" ry="20" className="la-ring" />
      <path d="M76 62 V30 H84 V62 Z" className="la-fac" />
      <circle cx="80" cy="26" r="4" className="la-puff" style={d(0)} />
      <text x="80" y="96" textAnchor="middle" className="la-cap">AREA AVERAGE, NOT STACK</text>
    </svg>
  )
}

const ART = [Pixels, Clouds, Sources, Missing, Sustained, Area]

export default function LimitArt({ i }: { i: number }) {
  const A = ART[i] ?? Pixels
  return (
    <div className="limit-art" aria-hidden="true">
      <A />
    </div>
  )
}
