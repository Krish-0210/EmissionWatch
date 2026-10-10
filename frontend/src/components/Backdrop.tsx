import { memo } from 'react'
import type { BackdropVariant } from '../lib/backdrop'
import '../styles/backdrop.css'

// Layered page background, back to front: vertical gradient, three radial glows (palette per page),
// two aurora bands, a measurement grid with "+" crosshairs and edge ruler, dust, vignette, film grain.
// All static: a base layer, a glow layer (repainted only while the palette cross-fades) and an overlay.

// Deterministic dust: position and size.
const DUST = Array.from({ length: 18 }, (_, i) => {
  const r = (k: number) => {
    const x = Math.sin((i + 1) * 12.9898 * k + 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  return { x: r(1) * 100, y: r(2) * 100, s: 1 + r(3) * 1.8, tone: i % 7 === 0 ? 'e' : i % 3 === 0 ? 's' : '' }
})

function Backdrop({ variant }: { variant: BackdropVariant }) {
  return (
    <div className={`bd ${variant}`} aria-hidden="true">
      <div className="bd-glows">
        <i className="bd-glow g1" />
        <i className="bd-glow g2" />
        <i className="bd-glow g3" />
        <i className="bd-aurora a1" />
        <i className="bd-aurora a2" />
      </div>
      <div className="bd-over">
        <div className="bd-gridwrap">
          <div className="bd-grid" />
        </div>
        <div className="bd-dust">
          {DUST.map((d, i) => (
            <i key={i} className={d.tone} style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.s, height: d.s }} />
          ))}
        </div>
        <i className="bd-vignette" />
      </div>
    </div>
  )
}

export default memo(Backdrop)
