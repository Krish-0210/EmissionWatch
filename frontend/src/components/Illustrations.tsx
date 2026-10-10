import type { CSSProperties } from 'react'

// Illustrated scenes (original line-art, theme colours, slow CSS loops; reduced motion stops them).
// Decorative unless `label` is given.
type SceneProps = { className?: string; label?: string }
const a11y = (label?: string) => (label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })
const d = (s: number) => ({ '--d': `${s}s` }) as CSSProperties

function Stars({ n = 18, w = 480, h = 150, seed = 3 }: { n?: number; w?: number; h?: number; seed?: number }) {
  return (
    <g className="il-stars">
      {Array.from({ length: n }, (_, i) => {
        const r = (k: number) => Math.abs(Math.sin((i + 1) * 12.9898 * k + seed * 78.233) * 43758.5453) % 1
        return <circle key={i} cx={r(1) * w} cy={r(2) * h} r={0.6 + r(3) * 0.9} style={d(r(4) * 4)} className={i % 4 ? '' : 'tw'} />
      })}
    </g>
  )
}

/** Satellite scanning a coal plant: orbit arc, scan cone, measurement rings on the ground, plume. */
export function SatellitePlantScene({ className = '', label }: SceneProps) {
  return (
    <svg viewBox="0 0 480 320" className={`il ${className}`} {...a11y(label)}>
      <defs>
        <linearGradient id="il-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7ce8d8" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7ce8d8" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="il-haze" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ff8a3d" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff8a3d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="il-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#111821" />
          <stop offset="1" stopColor="#07090c" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="il-fade-g" cx="50%" cy="80%" r="55%">
          <stop offset="0.55" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id="il-fade" maskUnits="userSpaceOnUse" x="-20" y="0" width="520" height="340">
          <rect x="-20" y="0" width="520" height="340" fill="url(#il-fade-g)" />
        </mask>
      </defs>
      <Stars />
      <path d="M-10 120 Q 240 -40 490 120" className="il-orbit" />
      {/* Ground: the curve of the Earth */}
      <g mask="url(#il-fade)">
        <path d="M-20 262 Q 240 214 500 262 V330 H-20 Z" fill="url(#il-ground)" />
        <path d="M-20 262 Q 240 214 500 262" className="il-horizon" />
      </g>
      {/* Scan cone from the satellite to the 20 km ring */}
      <path d="M352 82 L176 250 L300 250 Z" fill="url(#il-cone)" className="il-cone" />
      {/* Measurement rings */}
      <g transform="translate(238 250)">
        <ellipse rx="64" ry="11" className="il-ring" />
        <ellipse rx="128" ry="22" className="il-ring dashed" />
        <ellipse rx="64" ry="11" className="il-ring pulse" />
      </g>
      {/* Plant */}
      <ellipse cx="238" cy="236" rx="60" ry="30" fill="url(#il-haze)" className="il-breathe" />
      <g className="il-plant">
        <path d="M206 250 V232 L222 224 V232 L238 224 V250 Z" />
        <path d="M244 250 V206 H252 V250 Z M258 250 V198 H266 V250 Z" />
        <path d="M272 250 C276 236 270 226 276 214 H296 C302 226 296 236 300 250 Z" />
      </g>
      <g className="il-puffs">
        {[0, 1, 2].map((i) => (
          <circle key={i} cx="262" cy="194" r="5" style={d(i * 1.1)} />
        ))}
        {[0, 1].map((i) => (
          <circle key={`t${i}`} cx="286" cy="210" r="7" className="steam" style={d(0.6 + i * 1.6)} />
        ))}
      </g>
      {/* Satellite */}
      <g className="il-sat" transform="translate(352 78)">
        <g transform="rotate(-30)">
          <rect x="-7" y="-5" width="14" height="10" rx="1.5" className="il-body" />
          <rect x="-33" y="-4" width="22" height="8" className="il-panel" />
          <rect x="11" y="-4" width="22" height="8" className="il-panel" />
          <path d="M-11 0 H-7 M7 0 H11 M-22 -4 V4 M22 -4 V4" className="il-line" />
          <circle cx="0" cy="7" r="2" className="il-eye" />
        </g>
      </g>
    </svg>
  )
}

/** Inspector with a clipboard reading a brief; items tick off, one is flagged. */
export function InspectorScene({ className = '', label }: SceneProps) {
  return (
    <svg viewBox="0 0 400 320" className={`il ${className}`} {...a11y(label)}>
      <defs>
        <radialGradient id="il-spot" cx="50%" cy="45%" r="46%">
          <stop offset="0" stopColor="#7ce8d8" stopOpacity="0.12" />
          <stop offset="1" stopColor="#7ce8d8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="400" height="320" fill="url(#il-spot)" />
      {/* Distant plant */}
      <g className="il-far">
        <path d="M262 262 V236 L282 226 V236 L302 226 V262 Z M310 262 V200 H320 V262 Z M330 262 V210 H338 V262 Z" />
      </g>
      <g className="il-puffs far">
        {[0, 1, 2].map((i) => (
          <circle key={i} cx="315" cy="194" r="6" style={d(i * 1.2)} />
        ))}
      </g>
      <path d="M20 262 H380" className="il-horizon" />
      {/* Person */}
      <g className="il-person">
        <circle cx="132" cy="120" r="17" />
        <path d="M100 262 V196 C100 166 112 148 132 148 C152 148 164 166 164 196 V262" />
        <path d="M118 262 V218 M146 262 V218" />
      </g>
      {/* Clipboard */}
      <g className="il-board" transform="translate(150 166) rotate(-6)">
        <rect x="0" y="0" width="74" height="96" rx="6" />
        <rect x="24" y="-6" width="26" height="10" rx="3" className="clip" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(10 ${20 + i * 19})`}>
            <rect width="10" height="10" rx="2" className="box" />
            <path d="M18 5 H58" className="row" />
            {i === 2 ? (
              <path d="M5 1.5 V6 M5 8.4 V8.6" className="flag" pathLength={1} style={d(i * 0.7)} />
            ) : (
              <path d="M2 5.2 L4.4 7.6 L8.4 2.6" className="tick" pathLength={1} style={d(i * 0.7)} />
            )}
          </g>
        ))}
      </g>
      {/* Arm holding the board */}
      <path d="M156 178 C170 196 172 206 168 214" className="il-arm" />
      {/* Floating brief card */}
      <g className="il-card" transform="translate(250 64)">
        <rect width="110" height="76" rx="8" />
        <circle cx="26" cy="38" r="15" className="gauge-bg" />
        <circle cx="26" cy="38" r="15" className="gauge" pathLength={1} transform="rotate(-90 26 38)" />
        <path d="M50 28 H96 M50 38 H90 M50 48 H80" className="row" />
      </g>
    </svg>
  )
}

/** A city under concentric scan rings, with traffic and a factory: the many sources of NO2. */
export function RingsCityScene({ className = '', label }: SceneProps) {
  const towers = [
    [92, 46], [110, 70], [128, 38], [146, 90], [166, 58], [186, 110], [208, 74], [228, 96], [248, 52], [266, 82], [286, 64], [304, 40],
  ]
  return (
    <svg viewBox="0 0 480 300" className={`il ${className}`} {...a11y(label)}>
      <Stars n={14} h={110} seed={7} />
      {/* Rings in perspective around the city */}
      <g transform="translate(200 236)">
        {[0, 1, 2].map((i) => (
          <ellipse key={i} rx="190" ry="34" className="il-ring wave" style={d(i * 1.4)} />
        ))}
        <ellipse rx="90" ry="16" className="il-ring" />
        <ellipse rx="170" ry="30" className="il-ring dashed" />
      </g>
      {/* Skyline */}
      <g className="il-city">
        {towers.map(([x, h], i) => (
          <rect key={i} x={x} y={236 - h} width={16} height={h} />
        ))}
      </g>
      <g className="il-windows">
        {towers.flatMap(([x, h], i) =>
          Array.from({ length: Math.floor(h / 16) }, (_, k) => (
            <rect key={`${i}-${k}`} x={x + 5} y={236 - h + 8 + k * 16} width={3} height={3} style={d(((i * 7 + k * 3) % 10) * 0.45)} />
          )),
        )}
      </g>
      {/* Factory */}
      <g className="il-plant">
        <path d="M352 236 V214 L370 206 V214 L388 206 V236 Z M394 236 V184 H402 V236 Z" />
      </g>
      <g className="il-puffs">
        {[0, 1, 2].map((i) => (
          <circle key={i} cx="398" cy="178" r="5" style={d(i * 1.1)} />
        ))}
      </g>
      {/* Road with traffic */}
      <path d="M0 262 H480" className="il-road" />
      <g className="il-traffic">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i} style={d(i * 1.3)}>
            <rect x="-24" y="252" width="16" height="6" rx="2" />
            <circle cx="-7" cy="255" r="1.6" className="lamp" />
          </g>
        ))}
      </g>
    </svg>
  )
}

/** A magnifier over a plant's plume: inside the lens, satellite pixels with one flagged cell. */
export function MagnifierScene({ className = '', label }: SceneProps) {
  const cells = Array.from({ length: 25 }, (_, i) => ({ c: i % 5, r: Math.floor(i / 5) }))
  return (
    <svg viewBox="0 0 400 300" className={`il ${className}`} {...a11y(label)}>
      <defs>
        <clipPath id="mg-lens">
          <circle cx="232" cy="118" r="70" />
        </clipPath>
        <radialGradient id="mg-glass" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#7ce8d8" stopOpacity="0.16" />
          <stop offset="1" stopColor="#7ce8d8" stopOpacity="0.02" />
        </radialGradient>
        {/* soft plume as a gradient, not a blur filter (the lens animates, so it repaints every frame) */}
        <radialGradient id="mg-plume">
          <stop offset="0" stopColor="#ff8a3d" stopOpacity="0.5" />
          <stop offset="0.55" stopColor="#ff8a3d" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ff8a3d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Stars n={12} w={400} h={120} seed={11} />
      {/* Plant and plume */}
      <path d="M20 262 H380" className="il-road" />
      <g className="il-plant">
        <path d="M70 262 V226 L96 214 V226 L122 214 V262 Z M132 262 V170 H144 V262 Z M156 262 V186 H166 V262 Z" />
      </g>
      <g className="il-puffs">
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={138 + (i % 2) * 22} cy="160" r="7" style={d(i * 0.85)} />
        ))}
      </g>
      {/* The lens: pixel grid over the plume, one cell flagged */}
      <g className="mg-lens">
        <circle cx="232" cy="118" r="70" fill="url(#mg-glass)" />
        <g clipPath="url(#mg-lens)">
          {cells.map(({ c, r }) => (
            <rect key={`${c}-${r}`} x={162 + c * 28} y={48 + r * 28} width={28} height={28} className={`mg-cell${c === 1 && r === 3 ? ' hot' : ''}`} />
          ))}
          <circle cx="205" cy="148" r="28" fill="url(#mg-plume)" />
        </g>
        <circle cx="232" cy="118" r="70" className="mg-rim" />
        <circle cx="232" cy="118" r="76" className="mg-rim faint" />
        <path d="M282 168 L338 224" className="mg-handle" />
      </g>
      <g className="mg-tag">
        <rect x="250" y="34" width="140" height="24" rx="12" />
        <text x="320" y="50" textAnchor="middle">AUDIT, NOT VERDICT</text>
      </g>
    </svg>
  )
}
