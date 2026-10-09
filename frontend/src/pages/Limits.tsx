import { useMemo, useRef, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { fetchCluster, fetchClusters, fetchSummary, peekClusters, peekSummary } from '../api'
import Icon, { IconTile, type IconName } from '../components/Icons'
import LimitArt from '../components/LimitArt'
import PageHero, { Divider, type TickerItem } from '../components/PageHero'
import MaskLines from '../components/MaskLines'
import SectionHead from '../components/SectionHead'
import { fmt } from '../lib/format'
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

const RELATED: { name: string; url: string; icon: IconName; body: string }[] = [
  {
    name: 'Climate TRACE',
    url: 'https://climatetrace.org',
    icon: 'satellite',
    body: 'An independent coalition that estimates greenhouse-gas emissions for individual facilities worldwide, including power plants, from satellite and other remote-sensing data with machine learning.',
  },
  {
    name: 'CREA',
    url: 'https://energyandcleanair.org',
    icon: 'chart',
    body: 'The Centre for Research on Energy and Clean Air: independent research on air pollution and the energy transition, including analyses of India’s coal power fleet and of satellite pollution data.',
  },
]

const ADDS = [
  'Checks satellite NO₂ against what each cluster reports generating, day by day (CEA daily reports).',
  'Adjusts for wind, mixing height and season before comparing, and shows the residual.',
  'Ranks clusters with an Audit Risk Score, a confidence level and the reasons behind both.',
  'Open method, public map and plain-language view for citizens; anomalies, not verdicts.',
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
  const summary = useAsync(fetchSummary, [], peekSummary)
  const clusters = useAsync(fetchClusters, [], peekClusters)
  const ticker: TickerItem[] = useMemo(() => {
    const s = summary.data, c = clusters.data
    if (!s || !c) return []
    const bt = s.backtest.filter((r) => r.cluster !== 'POOLED')
    return [
      { label: 'One Sentinel-5P pixel', value: '≈ 5.5 × 3.5 km' },
      { label: 'Lockdown 2020: NO₂ fell in', value: `${bt.filter((r) => r.observed_change_pct < 0).length} of ${bt.length} clusters` },
      { label: 'Model over-predicted', value: `${bt.filter((r) => r.error > 0).length} of ${bt.length}`, color: '#ff8a3d' },
      { label: 'Pooled partial R² of generation', value: fmt(s.pooled_model.enhancement.partial_r2, 3) },
      { label: 'Low-confidence clusters', value: c.clusters.filter((x) => x.confidence === 'low').map((x) => x.name).join(', ') || 'none' },
    ]
  }, [summary.data, clusters.data])

  return (
    <div className="limits-page">
      <PageHero
        eyebrow={
          <>
            <Icon name="grid" size={18} /> Limits
          </>
        }
        title="What this"
        dim="cannot do."
        lede="PanoptiCoal is a screening tool. It points inspectors to where a closer look is most likely to be useful. Here is what it cannot do."
        word="Limits"
        visual={<PixelGrid />}
        ticker={ticker}
      />

      <section className="container section-tight">
        <div style={{ marginBottom: 28 }}>
          <SectionHead n="01" label="Six limits of this method" tone="ember" />
        </div>
        <div className="limits-grid spot-group">
          {LIMITS.map((l, i) => (
            <article className="card limit tilt reveal" data-tilt="4" key={l.title} style={{ '--d': `${(i % 3) * 110}ms` } as CSSProperties}>
              <LimitArt i={i} />
              <span className="mono limit-n">0{i + 1}</span>
              <h2 className="limit-title">{l.title}</h2>
              <p className="muted">{l.body}</p>
            </article>
          ))}
        </div>
        <Divider />
      </section>

      <section className="container section-tight">
        <SectionHead n="02" label="Related work" />
        <h2 className="display d-lg mask" style={{ margin: '14px 0 28px' }}>
          <MaskLines lines={['Others watch too.', 'Here is what we add.']} delay={80} />
        </h2>
        <div className="related spot-group">
          {RELATED.map((r, i) => (
            <a key={r.name} className="card related-card tilt reveal" data-tilt="3" href={r.url} target="_blank" rel="noreferrer" style={{ '--d': `${i * 110}ms` } as CSSProperties}>
              <IconTile name={r.icon} />
              <h3>
                {r.name} <span aria-hidden="true">↗</span>
              </h3>
              <p className="muted small">{r.body}</p>
              <span className="micro">{r.url.replace('https://', '')}</span>
            </a>
          ))}
          <div className="card related-card adds reveal" style={{ '--d': '220ms' } as CSSProperties}>
            <IconTile name="eye" tone="ember" />
            <h3>What PanoptiCoal adds</h3>
            <ul className="adds-list">
              {ADDS.map((a) => (
                <li key={a}>
                  <Icon name="shield" size={18} />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p style={{ marginTop: 40 }}>
          <Link to="/how-it-works" className="pill ghost magnetic" viewTransition>
            How the method works <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </p>
      </section>
    </div>
  )
}
