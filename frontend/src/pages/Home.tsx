import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { fetchClusters, fetchSummary, fetchTimeseries } from '../api'
import BigWord from '../components/BigWord'
import CountUp from '../components/CountUp'
import { IconTile, type IconName } from '../components/Icons'
import { InspectorScene, MagnifierScene } from '../components/Illustrations'
import GlobePoster from '../components/GlobePoster'
import HeroOrbit, { type OrbitChip } from '../components/HeroOrbit'
import HomeStory from '../components/HomeStory'
import Intro, { type IntroBeat } from '../components/Intro'
import MaskLines from '../components/MaskLines'
import { holdNav, shouldPlayIntro } from '../lib/intro'
import { Divider, Ticker, type TickerItem } from '../components/PageHero'
import { fmt, fmtInt, RISK_COLOR } from '../lib/format'
import { ScrollTrigger } from '../lib/gsap'
import { useIsMobile, useReducedMotion } from '../lib/motion'
import { useBackdropTone } from '../lib/backdrop'
import { scrollTop, scrollToY } from '../lib/scroll'
import { STEP_AT, stepFor, type RegisterDrive } from '../lib/story'
import { webglOk } from '../lib/webgl'
import { useAsync } from '../lib/useAsync'
import type { GlobeControl } from '../three/GlobeScene'
import './home.css'

// When the intro will play, the 3D chunk starts downloading with this module, so its set-up is
// done during the intro's boot beat.
const globeChunk = shouldPlayIntro() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? import('../three/GlobeCanvas') : null
const GlobeCanvas = lazy(() => globeChunk ?? import('../three/GlobeCanvas'))

const PROBLEMS: { title: string; body: string; icon: IconName }[] = [
  {
    icon: 'doc',
    title: 'Self-reported data',
    body: 'Coal plants report their own generation and emissions. Independent checks on the ground are rare and slow.',
  },
  {
    icon: 'person',
    title: 'Too many plants, too few inspectors',
    body: 'India runs over 200 GW of coal capacity. Regulators need a way to decide where to look first.',
  },
  {
    icon: 'cloud',
    title: 'Pollution people breathe',
    body: 'Nitrogen dioxide (NO₂) from coal combustion harms lungs and forms smog and fine particles downwind.',
  },
]

const AUDIENCES: { title: string; body: string; icon: IconName }[] = [
  {
    icon: 'shield',
    title: 'Regulators',
    body: 'A ranked list of clusters where an inspection is most likely to find something, with a written brief for each.',
  },
  {
    icon: 'pin',
    title: 'Citizens',
    body: 'Find the coal plants near you and see, in plain language, whether satellite data matches what they report.',
  },
  {
    icon: 'chart',
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
  const hero = useRef<HTMLDivElement>(null)
  const orbit = useRef<HTMLDivElement>(null)
  const storyDrive = useRef<((p: number) => void) | null>(null)
  const register = useCallback<RegisterDrive>((fn) => {
    storyDrive.current = fn
    return () => {
      if (storyDrive.current === fn) storyDrive.current = null
    }
  }, [])
  const [step, setStep] = useState(-1)
  const [mount3d, setMount3d] = useState(false)
  const [ready3d, setReady3d] = useState(false)
  const onReady = useCallback(() => setReady3d(true), [])

  // Intro: every fresh load of Home (?intro=0 skips); the footer's "Replay intro" link replays it.
  const [introOn, setIntroOn] = useState(shouldPlayIntro)
  const [introKey, setIntroKey] = useState(0)
  const [noGl, setNoGl] = useState(false)
  const [landed, setLanded] = useState(!introOn) // the 3D globe is shown (the intro's dots hand over)
  const [heroIn, setHeroIn] = useState(false)
  const onBeat = useCallback((b: IntroBeat) => {
    const c = control.current
    if (b === 'warm') c.paused = false
    else if (b === 'nav') holdNav(false)
    else if (b === 'land') {
      c.intro = 1
      setLanded(true)
    } else if (b === 'hero') setHeroIn(true)
    else if (b === 'done') setIntroOn(false)
  }, [])
  // During the intro the 3D globe renders one frame (set-up cost paid while the screen is dark) and
  // then waits, paused, until the intro's 'warm' beat.
  useLayoutEffect(() => {
    if (!introOn) return
    control.current.paused = true
    control.current.intro = 0
  }, [introOn, introKey])
  // Replay (footer link, from any page): router state { replayIntro } -> restart the intro from the
  // top, then clear the state so Back/refresh does not replay it again.
  const location = useLocation()
  const navigate = useNavigate()
  const replay = (location.state as { replayIntro?: number } | null)?.replayIntro
  const [seenReplay, setSeenReplay] = useState<number>()
  if (replay && replay !== seenReplay) {
    setSeenReplay(replay)
    setHeroIn(false)
    setLanded(false)
    setIntroKey((k) => k + 1)
    setIntroOn(true)
  }
  useLayoutEffect(() => {
    if (!introKey) return
    scrollTop()
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per replay
  }, [introKey])
  const requestScan = useCallback((idx: number) => {
    control.current.scan = { idx, t: performance.now() }
  }, [])
  // No intro: the hero copy enters on the next frame.
  useEffect(() => {
    if (introOn) return
    const id = requestAnimationFrame(() => setHeroIn(true))
    return () => cancelAnimationFrame(id)
  }, [introOn])

  // During the intro the 3D hero loads straight away (after the intro's first paint).
  useEffect(() => {
    if (!introOn || reduced) return
    const id = setTimeout(() => {
      if (webglOk()) setMount3d(true)
      else setNoGl(true)
    }, 60)
    return () => clearTimeout(id)
  }, [introOn, reduced])

  // Otherwise the 3D scene (and the WebGL probe, which can block for a while on first GPU use) loads
  // on the first sign of intent (pointer, scroll, touch, key) or after 2.5 s; the poster shows until then.
  useEffect(() => {
    if (reduced || introOn || mount3d) return
    const events = ['pointermove', 'pointerdown', 'wheel', 'scroll', 'touchstart', 'keydown'] as const
    let done = false
    const go = () => {
      if (done) return
      done = true
      cleanup()
      if (webglOk()) setMount3d(true)
    }
    const id = setTimeout(go, 2500)
    events.forEach((e) => window.addEventListener(e, go, { passive: true, once: true }))
    function cleanup() {
      clearTimeout(id)
      events.forEach((e) => window.removeEventListener(e, go))
    }
    return cleanup
  }, [reduced, introOn, mount3d])

  // Scroll progress through the pinned stage. Continuous values go straight to refs and DOM;
  // React only re-renders when the story step changes.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const apply = (p: number) => {
      control.current.progress = p
      setStep(stepFor(p))
      storyDrive.current?.(p)
      const out = Math.min(1, p / 0.1)
      for (const h of [hero.current, orbit.current]) {
        if (!h) continue
        h.style.opacity = String(1 - out)
        h.style.transform = `translate3d(0, ${(-out * 40).toFixed(1)}px, 0)`
        h.style.visibility = out >= 1 ? 'hidden' : ''
      }
      if (hero.current) hero.current.style.pointerEvents = out > 0.5 ? 'none' : ''
    }
    const st = ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom', onUpdate: (s) => apply(s.progress) })
    apply(st.progress)
    return () => st.kill()
  }, [])

  // Background glow follows the story step (Score = the top cluster's risk colour).
  useBackdropTone('step', step >= 0 ? String(step) : undefined)
  useBackdropTone('tone', focus?.risk_level)

  // Story chips / arrows: scroll to ~70% through the step's range, where its animation has played.
  const goStep = useCallback((i: number) => {
    const el = stage.current
    if (!el || i < 0 || i > 3) return
    const a = STEP_AT[i], b = STEP_AT[i + 1] ?? 1
    const top = el.getBoundingClientRect().top + window.scrollY
    scrollToY(top + (a + 0.72 * (b - a)) * (el.offsetHeight - window.innerHeight), 1.2)
  }, [])

  const years = months?.length ? `${months[0].month.slice(0, 4)}–${months[months.length - 1].month.slice(0, 4)}` : '2019–2026'
  const nClusters = clusters.data?.clusters.length ?? 11
  const days = summary.data?.pooled_model.enhancement.n
  const chips: OrbitChip[] = useMemo(
    () => [
      { label: 'Sentinel-5P', value: 'NO₂', icon: 'satellite' },
      { label: 'CEA', value: 'Daily generation', icon: 'plant' },
      { label: 'ERA5', value: 'Wind', icon: 'wind' },
      { label: 'clusters', value: String(nClusters), icon: 'pin', lead: true },
      { label: 'cluster-days', value: days ? fmtInt(days) : '…', icon: 'chart', lead: true },
    ],
    [nClusters, days],
  )
  const ticker: TickerItem[] = useMemo(() => {
    const c = clusters.data, s = summary.data
    if (!c || !s) return []
    const top = [...c.clusters].sort((a, b) => b.risk_score - a.risk_score)
    const e = s.pooled_model.enhancement
    return [
      { label: 'Data as of', value: c.as_of },
      { label: 'Highest audit risk', value: `${top[0].name} ${Math.round(top[0].risk_score)}`, color: RISK_COLOR[top[0].risk_level] },
      { label: 'High-risk clusters', value: String(c.clusters.filter((x) => x.risk_level === 'high').length), color: RISK_COLOR.high },
      { label: 'Plants · capacity', value: `${c.clusters.reduce((a, x) => a + x.n_plants, 0)} · ${fmtInt(c.clusters.reduce((a, x) => a + x.capacity_mw, 0))} MW` },
      { label: 'Pooled effect', value: `${fmt(e.coef, 2)} µmol/m² per MU/day · t ${fmt(e.t, 1)}` },
      { label: 'Cluster-days analysed', value: fmtInt(e.n) },
    ]
  }, [clusters.data, summary.data])

  return (
    <>
      <div ref={stage} className="stage">
        <div className="stage-sticky" data-hold>
          <div className={`stage-visual${ready3d ? ' ready' : ''}${landed ? '' : ' hold'}`}>
            <GlobePoster />
            {mount3d && clusters.data && focus && (
              <Suspense fallback={null}>
                <GlobeCanvas clusters={clusters.data.clusters} focusId={focus.id} control={control} lite={mobile} onReady={onReady} />
              </Suspense>
            )}
          </div>
          <div className="stage-vignette" aria-hidden="true" />

          <div ref={hero} className={`hero container${heroIn ? ' in' : ''}`}>
            <div className="micro signal hero-micro">
              <span className="live-dot" aria-hidden="true" /> Live data · {clusters.data?.clusters.length ?? 11} clusters · {years}
            </div>
            <h1 className="display d-xl hero-title">
              <MaskLines lines={['Coal plants report', 'their own pollution.', 'We watch from space.']} accentFrom={2} delay={120} step={150} />
            </h1>
            <p className="lede hero-lede">
              PanoptiCoal compares daily satellite measurements of nitrogen dioxide around India’s largest coal plant
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

          <HeroOrbit ref={orbit} chips={chips} clusters={clusters.data?.clusters} onScan={requestScan} live={mount3d && ready3d && landed} on={heroIn} />

          {clusters.data && focus && step >= 0 && (
            <HomeStory register={register} progress={control} step={step} clusters={clusters.data.clusters} focus={focus} summary={summary.data} months={months} go={goStep} />
          )}
        </div>
      </div>

      <HomeSections clusterCount={clusters.data?.clusters.length ?? 11} years={years} ticker={ticker} />
      {introOn && <Intro key={introKey} clusters={clusters.data} summary={summary.data} reduced={reduced} ready={ready3d || noGl} onBeat={onBeat} />}
    </>
  )
}

// Static sections below the stage; memoised so step changes in the story don't re-render them.
const HomeSections = memo(function HomeSections({ clusterCount, years, ticker }: { clusterCount: number; years: string; ticker: TickerItem[] }) {
  return (
    <>
      <Ticker items={ticker} />
      <section className="section">
        <BigWord style={{ top: '0.1em', right: '-0.05em' }}>01</BigWord>
        <div className="container layer">
          <div className="micro signal reveal">01 / The problem</div>
          <h2 className="display d-lg mask" style={{ marginTop: 14 }}>
            <MaskLines lines={['Emissions oversight', 'runs on trust.']} delay={80} />
          </h2>
          <Divider />
          <div className="grid grid-3 spot-group">
            {PROBLEMS.map((x, i) => (
              <div className="card tilt reveal" key={x.title} style={{ '--d': `${i * 110}ms` } as React.CSSProperties}>
                <div className="row between" style={{ marginBottom: 18 }}>
                  <IconTile name={x.icon} tone={i === 2 ? 'ember' : 'signal'} />
                  <span className="micro">0{i + 1}</span>
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
          <h2 className="display d-lg mask" style={{ marginTop: 14 }}>
            <MaskLines lines={['Built for the people', 'who act on it.']} delay={80} />
          </h2>
          <Divider />
          <div className="audience-wrap">
            <div className="audience">
              {AUDIENCES.map((a, i) => (
                <div className="audience-row reveal" key={a.title} style={{ '--d': `${i * 110}ms` } as React.CSSProperties}>
                  <IconTile name={a.icon} />
                  <h3 className="display d-sm">{a.title}</h3>
                  <p className="muted">{a.body}</p>
                </div>
              ))}
            </div>
            <InspectorScene className="audience-il reveal" label="An inspector with a clipboard reviewing a brief" />
          </div>
        </div>
      </section>

      <section className="section-tight numbers" aria-label="Key numbers">
        <div className="container">
          <div className="numbers-grid">
            <div className="reveal">
              <CountUp value={clusterCount} pad={2} className="num" />
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
          <div className="honest-wrap">
          <div className="honest reveal">
            <div className="micro ember">03 / Honest by design</div>
            <p className="display d-md mask" style={{ margin: '18px 0 22px' }}>
              <MaskLines lines={['Anomalies that warrant an audit,', 'not proof of wrongdoing.']} tone="ember" delay={120} />
            </p>
            <p className="muted" style={{ maxWidth: '64ch' }}>
              Satellite pixels are coarse, clouds hide the monsoon months, and other sources also emit NO₂. Every score
              comes with a confidence level and the reasons behind it. <Link to="/limits">See the limits</Link>.
            </p>
          </div>
          <MagnifierScene className="honest-il reveal" label="A magnifier over a coal plant's plume, showing satellite pixels with one cell flagged for audit" />
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
})
