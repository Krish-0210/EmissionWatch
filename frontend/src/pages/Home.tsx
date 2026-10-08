import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchClusters, fetchSummary, fetchTimeseries } from '../api'
import BigWord from '../components/BigWord'
import CountUp from '../components/CountUp'
import GlobePoster from '../components/GlobePoster'
import HomeStory from '../components/HomeStory'
import { ScrollTrigger } from '../lib/gsap'
import { useIsMobile, useReducedMotion } from '../lib/motion'
import { stepFor } from '../lib/story'
import { useAsync } from '../lib/useAsync'
import type { GlobeControl } from '../three/GlobeScene'
import './home.css'

const GlobeCanvas = lazy(() => import('../three/GlobeCanvas'))

const PROBLEMS = [
  {
    title: 'Self-reported data',
    body: 'Coal plants report their own generation and emissions. Independent checks on the ground are rare and slow.',
  },
  {
    title: 'Too many plants, too few inspectors',
    body: 'India runs over 200 GW of coal capacity. Regulators need a way to decide where to look first.',
  },
  {
    title: 'Pollution people breathe',
    body: 'Nitrogen dioxide (NO₂) from coal combustion harms lungs and forms smog and fine particles downwind.',
  },
]

const AUDIENCES = [
  {
    title: 'Regulators',
    body: 'A ranked list of clusters where an inspection is most likely to find something, with a written brief for each.',
  },
  {
    title: 'Citizens',
    body: 'Find the coal plants near you and see, in plain language, whether satellite data matches what they report.',
  },
  {
    title: 'Researchers',
    body: 'Open method, model statistics and limits. Every number traces back to public data and open code.',
  },
]

const SOURCES = [
  'Central Electricity Authority (CEA)',
  'National Power Portal',
  'ESA Sentinel-5P TROPOMI',
  'Google Earth Engine',
  'ECMWF ERA5',
  'Global Energy Monitor',
]

function webglOk() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function Home() {
  const clusters = useAsync(fetchClusters, [])
  const summary = useAsync(fetchSummary, [])
  const ranked = clusters.data ? [...clusters.data.clusters].sort((a, b) => b.risk_score - a.risk_score) : []
  const focus = ranked[0]
  const ts = useAsync(() => (focus ? fetchTimeseries(focus.id) : Promise.resolve(undefined)), [focus?.id])
  const months = ts.data?.months

  const reduced = useReducedMotion()
  const mobile = useIsMobile()
  const stage = useRef<HTMLDivElement>(null)
  const control = useRef<GlobeControl>({ progress: 0, dragging: false, dragYaw: 0, dragPitch: 0, mouseX: 0, mouseY: 0 })
  const [p, setP] = useState(0)
  const [mount3d, setMount3d] = useState(false)
  const [ready3d, setReady3d] = useState(false)
  const onReady = useCallback(() => setReady3d(true), [])

  // Load the 3D scene after first paint, when the browser is idle.
  useEffect(() => {
    if (reduced || !webglOk()) return
    const go = () => setMount3d(true)
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(go, { timeout: 1200 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(go, 400)
    return () => clearTimeout(id)
  }, [reduced])

  // Scroll progress through the pinned stage.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (s) => {
        control.current.progress = s.progress
        setP(s.progress)
      },
    })
    return () => st.kill()
  }, [])

  const step = stepFor(p)
  const heroOut = Math.min(1, p / 0.1)
  const years = months?.length ? `${months[0].month.slice(0, 4)}–${months[months.length - 1].month.slice(0, 4)}` : '2019–2026'

  return (
    <>
      <div ref={stage} className="stage">
        <div className="stage-sticky">
          <div className={`stage-visual ${ready3d ? 'ready' : ''}`}>
            <GlobePoster className={`${mobile ? 'mobile' : ''}`} />
            {mount3d && clusters.data && focus && (
              <Suspense fallback={null}>
                <GlobeCanvas clusters={clusters.data.clusters} focusId={focus.id} control={control} lite={mobile} onReady={onReady} />
              </Suspense>
            )}
          </div>
          <div className="stage-vignette" aria-hidden="true" />

          <div
            className="hero container"
            style={{ opacity: 1 - heroOut, transform: `translateY(${-heroOut * 40}px)`, pointerEvents: heroOut > 0.5 ? 'none' : undefined }}
          >
            <div className="micro signal hero-micro">
              <span className="live-dot" aria-hidden="true" /> Live data · {clusters.data?.clusters.length ?? 11} clusters · {years}
            </div>
            <h1 className="display d-xl hero-title">
              Coal plants report their own pollution.
              <span className="dim">We check it from space.</span>
            </h1>
            <p className="lede hero-lede">
              EmissionWatch compares daily satellite measurements of nitrogen dioxide around India’s largest coal plant
              clusters with the electricity they report generating, and flags where the two stop matching.
            </p>
            <div className="row">
              <Link to="/map" className="pill">
                Explore the map <span className="arrow" aria-hidden="true">→</span>
              </Link>
              <Link to="/near-me" className="pill ghost">
                Find plants near me
              </Link>
            </div>
            <div className="micro scroll-cue" aria-hidden="true">
              Scroll · the method in four steps
            </div>
          </div>

          {clusters.data && focus && step >= 0 && (
            <HomeStory p={p} step={step} clusters={clusters.data.clusters} focus={focus} summary={summary.data} months={months} />
          )}
        </div>
      </div>

      <section className="section">
        <BigWord style={{ top: '0.1em', right: '-0.05em' }}>01</BigWord>
        <div className="container layer">
          <div className="micro signal reveal">01 / The problem</div>
          <h2 className="display d-lg reveal" style={{ '--d': '80ms', marginTop: 14 } as React.CSSProperties}>
            Emissions oversight <span className="dim">runs on trust.</span>
          </h2>
          <div className="rule draw" style={{ margin: '40px 0' }} />
          <div className="grid grid-3">
            {PROBLEMS.map((x, i) => (
              <div className="card reveal" key={x.title} style={{ '--d': `${i * 110}ms` } as React.CSSProperties}>
                <div className="micro" style={{ marginBottom: 18 }}>
                  0{i + 1}
                </div>
                <h3>{x.title}</h3>
                <p className="muted">{x.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <BigWord style={{ top: '0.1em', left: '-0.05em' }}>02</BigWord>
        <div className="container layer">
          <div className="micro signal reveal">02 / Who it’s for</div>
          <h2 className="display d-lg reveal" style={{ '--d': '80ms', marginTop: 14 } as React.CSSProperties}>
            Built for the people <span className="dim">who act on it.</span>
          </h2>
          <div className="rule draw" style={{ margin: '40px 0' }} />
          <div className="audience">
            {AUDIENCES.map((a, i) => (
              <div className="audience-row reveal" key={a.title} style={{ '--d': `${i * 110}ms` } as React.CSSProperties}>
                <span className="micro mono">0{i + 1}</span>
                <h3 className="display d-sm">{a.title}</h3>
                <p className="muted">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-tight numbers" aria-label="Key numbers">
        <div className="container">
          <div className="numbers-grid">
            <div className="reveal">
              <CountUp value={clusters.data?.clusters.length ?? 11} pad={2} className="num" />
              <div className="micro">coal plant clusters</div>
            </div>
            <div className="reveal" style={{ '--d': '100ms' } as React.CSSProperties}>
              <span className="num mono">{years}</span>
              <div className="micro">years of data</div>
            </div>
            <div className="reveal" style={{ '--d': '200ms' } as React.CSSProperties}>
              <CountUp value={2800} prefix="~" className="num" />
              <div className="micro">daily generation reports</div>
            </div>
            <div className="reveal" style={{ '--d': '300ms' } as React.CSSProperties}>
              <span className="num mono">Daily</span>
              <div className="micro">satellite NO₂ measurements</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <BigWord style={{ top: '0.1em', right: '-0.05em' }}>03</BigWord>
        <div className="container layer">
          <div className="honest reveal">
            <div className="micro ember">03 / Honest by design</div>
            <p className="display d-md" style={{ margin: '18px 0 22px' }}>
              Anomalies that warrant an audit, <span className="dim">not proof of wrongdoing.</span>
            </p>
            <p className="muted" style={{ maxWidth: '64ch' }}>
              Satellite pixels are coarse, clouds hide the monsoon months, and other sources also emit NO₂. Every score
              comes with a confidence level and the reasons behind it. <Link to="/limits">See the limits</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="container">
          <div className="micro reveal" style={{ marginBottom: 20 }}>
            04 / Data sources
          </div>
          <ul className="sources">
            {SOURCES.map((s, i) => (
              <li key={s} className="reveal" style={{ '--d': `${i * 70}ms` } as React.CSSProperties}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
