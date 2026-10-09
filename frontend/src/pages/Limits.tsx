import { useRef, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { fetchCluster } from '../api'
import BigWord from '../components/BigWord'
import { useInView } from '../lib/motion'
import { useAsync } from '../lib/useAsync'
import './limits.css'

const LIMITS = [
  {
    title: 'Satellite pixels are coarse',
    body: 'Sentinel-5P pixels are roughly 5 km across. Plants a few kilometres apart cannot be told apart, so we assess clusters of plants, not individual plants or units.',
  },
  {
    title: 'Clouds hide the monsoon',
    body: 'The satellite cannot see NO₂ through thick cloud. Most monsoon months have too few clear days and are left out, so scores lean on the dry season.',
  },
  {
    title: 'Coal plants are not the only source',
    body: 'Traffic, industry, mining and burning also emit NO₂. The model compares each cluster with its own history and with nearby background air, but other sources still affect the readings. During the 2020 lockdown, NO₂ fell even where generation stayed flat.',
  },
  {
    title: 'Some plants are missing from the reports',
    body: 'Captive plants that serve a factory do not appear in CEA generation reports. Where they sit inside a cluster, the satellite sees their NO₂ but the model cannot attribute it. Those clusters get a lower confidence level.',
  },
  {
    title: 'Sustained patterns, not single days',
    body: 'Daily readings are noisy. The risk score looks at the last 90 days against years of history and at multi-year trends. One bad day does not move it, and a single good day does not clear it.',
  },
  {
    title: 'Not proof of a violation',
    body: 'A high score means satellite NO₂ is higher than reported generation and weather explain. That is a reason to inspect, not evidence that a plant broke the law. Emission limits apply to stack concentrations, which satellites do not measure.',
  },
]

// Real plant positions of one cluster, with a 5.5 × 3.5 km pixel grid snapping over them.
const PX_PER_KM = 20
const CELL = { w: 5.5, h: 3.5 }
const W = 640, H = 400

function PixelGrid() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { rootMargin: '0px 0px -25% 0px' })
  const { data } = useAsync(() => fetchCluster('neyveli'), [])
  const plants = (data?.plants ?? []).filter((p) => p.status === 'operating')
  const lat0 = plants.reduce((a, p) => a + p.lat, 0) / (plants.length || 1)
  const lon0 = plants.reduce((a, p) => a + p.lon, 0) / (plants.length || 1)
  const pos = plants.map((p) => ({
    p,
    x: W / 2 + (p.lon - lon0) * 111.32 * Math.cos((lat0 * Math.PI) / 180) * PX_PER_KM,
    y: H / 2 - (p.lat - lat0) * 110.57 * PX_PER_KM,
  }))
  const cw = CELL.w * PX_PER_KM, ch = CELL.h * PX_PER_KM
  // Grid origin: a cell centred on the cluster, extended left/up past the edge.
  const ox = W / 2 - cw / 2 - Math.ceil((W / 2 - cw / 2) / cw) * cw
  const oy = H / 2 - ch / 2 - Math.ceil((H / 2 - ch / 2) / ch) * ch
  const cols = Math.ceil((W - ox) / cw), rows = Math.ceil((H - oy) / ch)
  const lit = new Set(pos.map(({ x, y }) => `${Math.floor((x - ox) / cw)},${Math.floor((y - oy) / ch)}`))

  return (
    <div className={`pixel-demo${inView ? ' in' : ''}`} ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${data?.name ?? 'Cluster'} plants under a 5.5 by 3.5 km satellite pixel grid: several plants share pixels`}>
        <defs>
          <radialGradient id="lp-glow">
            <stop offset="0%" stopColor="#ff8a3d" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ff8a3d" stopOpacity="0" />
          </radialGradient>
        </defs>
        {pos.map(({ p, x, y }) => (
          <circle key={`g-${p.id}`} cx={x} cy={y} r="44" fill="url(#lp-glow)" />
        ))}
        <g className="grid-layer">
          {Array.from({ length: cols * rows }, (_, i) => {
            const c = i % cols, r = Math.floor(i / cols)
            const on = lit.has(`${c},${r}`)
            return (
              <rect
                key={i}
                x={ox + c * cw}
                y={oy + r * ch}
                width={cw}
                height={ch}
                className={`cell${on ? ' lit' : ''}`}
                style={{ transitionDelay: `${(c + r) * 35}ms` }}
              />
            )
          })}
        </g>
        {pos.map(({ p, x, y }, i) => (
          <g key={p.id}>
            <circle cx={x} cy={y} r="5" className="plant" />
            <text x={x + 10} y={y + (i % 2 ? 16 : -10)} className="plant-label">
              {p.name.replace(/\s*\(.*\)/, '').toUpperCase()}
            </text>
          </g>
        ))}
        <g transform={`translate(${W - 24 - 5 * PX_PER_KM} ${H - 26})`}>
          <line x1="0" x2={5 * PX_PER_KM} y1="0" y2="0" stroke="#8a96a3" />
          <text x={(5 * PX_PER_KM) / 2} y="-8" textAnchor="middle" className="plant-label">5 KM</text>
        </g>
      </svg>
      <div className="clouds" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="pixel-caption micro">
        {data?.name ?? 'Neyveli'} · {plants.length} plants · one Sentinel-5P pixel ≈ 5.5 × 3.5 km
      </div>
    </div>
  )
}

export default function Limits() {
  return (
    <div className="limits-page">
      <section className="section-tight" style={{ position: 'relative', overflow: 'hidden' }}>
        <BigWord style={{ top: '0.05em', right: '-0.05em' }}>Limits</BigWord>
        <div className="container layer">
          <div className="micro signal reveal">Limits</div>
          <h1 className="display d-lg reveal" style={{ '--d': '80ms', margin: '14px 0 18px' } as CSSProperties}>
            What this <span className="dim">cannot do.</span>
          </h1>
          <p className="lede reveal" style={{ '--d': '160ms' } as CSSProperties}>
            PanoptiCoal is a screening tool. It points inspectors to where a closer look is most likely to be useful.
            Here is what it cannot do.
          </p>
          <div className="reveal" style={{ '--d': '220ms', marginTop: 40 } as CSSProperties}>
            <PixelGrid />
          </div>
        </div>
      </section>

      <section className="container section-tight">
        <div className="limits-list">
          {LIMITS.map((l, i) => (
            <article className="limit reveal" key={l.title} style={{ '--d': `${(i % 2) * 120}ms` } as CSSProperties}>
              <span className="mono limit-n">0{i + 1}</span>
              <div>
                <h2 className="limit-title">{l.title}</h2>
                <p className="muted">{l.body}</p>
              </div>
            </article>
          ))}
        </div>
        <p style={{ marginTop: 40 }}>
          <Link to="/how-it-works" className="pill ghost">
            How the method works <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </p>
      </section>
    </div>
  )
}
