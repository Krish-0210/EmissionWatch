import Lenis from 'lenis'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { backdropFor } from '../lib/backdrop'
import { setLenis } from '../lib/scroll'
import { gsap, ScrollTrigger } from '../lib/gsap'
import { useInteractions } from '../lib/interactions'
import { prefersReducedMotion } from '../lib/motion'
import Backdrop from './Backdrop'
import BigWord from './BigWord'
import Cursor from './Cursor'
import { Wordmark } from './Logo'

export const GITHUB_URL = 'https://github.com/Krish-0210/EmissionWatch'

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/map', label: 'Risk Map' },
  { to: '/near-me', label: 'Near Me' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/limits', label: 'Limits' },
]

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

let lenis: Lenis | null = null // mirrored in lib/scroll for page-level scrollTo


// Smooth scroll on desktop with motion allowed; touch keeps native scrolling. Lenis runs inside
// GSAP's ticker (first in the queue) and feeds ScrollTrigger, so there is a single frame loop.
function useSmoothScroll() {
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh()
    document.fonts?.ready.then(refresh)
    window.addEventListener('load', refresh, { once: true })
    if (prefersReducedMotion() || window.matchMedia('(pointer: coarse)').matches) return () => window.removeEventListener('load', refresh)
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false, wheelMultiplier: 0.9, autoRaf: false })
    lenis.on('scroll', ScrollTrigger.update)
    setLenis(lenis)
    const tick = (t: number) => lenis?.raf(t * 1000)
    gsap.ticker.add(tick, false, true)
    gsap.ticker.lagSmoothing(0)
    return () => {
      window.removeEventListener('load', refresh)
      gsap.ticker.remove(tick)
      lenis?.destroy()
      lenis = null
      setLenis(null)
    }
  }, [])
}

// Adds .in to .reveal / .rule elements as they enter the viewport, and drifts [data-parallax]
// elements relative to their section. Watches the DOM so lazily loaded content is picked up.
function useRevealAndParallax(root: React.RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const reduced = prefersReducedMotion()
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }),
      { rootMargin: '0px 0px -10% 0px' },
    )
    const seen = new WeakSet<Element>()
    let para: HTMLElement[] = []
    let dirty = true
    let lastY = -1
    const scan = () => {
      el.querySelectorAll('.reveal, .rule, .trig, .draw, .divider, .mask, .blur-in').forEach((n) => {
        if (!seen.has(n)) {
          seen.add(n)
          io.observe(n)
        }
      })
      para = Array.from(el.querySelectorAll<HTMLElement>('[data-parallax]'))
      dirty = true
    }
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(el, { childList: true, subtree: true })

    // Parallax runs on GSAP's ticker (after Lenis) only when the scroll position moved; all rects
    // are read before any write.
    const update = () => {
      const sy = window.scrollY
      if (!dirty && sy === lastY) return
      dirty = false
      lastY = sy
      const vh = window.innerHeight
      const ys = para.map((p) => {
        const r = p.parentElement?.getBoundingClientRect()
        if (!r || r.bottom < -200 || r.top > vh + 200) return null
        return (r.top + r.height / 2 - vh / 2) * -(Number(p.dataset.parallax) || 0.15)
      })
      ys.forEach((y, i) => {
        if (y != null) para[i].style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`
      })
    }
    const onResize = () => {
      dirty = true
    }
    if (!reduced) {
      window.addEventListener('resize', onResize)
      gsap.ticker.add(update)
    }
    return () => {
      io.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', onResize)
      gsap.ticker.remove(update)
    }
  }, [root, key])
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const main = useRef<HTMLElement>(null)
  useSmoothScroll()
  useInteractions()
  useRevealAndParallax(main, pathname)

  // Before paint, so a view transition captures the new page at the top.
  useLayoutEffect(() => {
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true })
    else window.scrollTo(0, 0)
  }, [pathname])
  useEffect(() => {
    const id = setTimeout(() => ScrollTrigger.refresh(), 450)
    return () => clearTimeout(id)
  }, [pathname])
  // The logo eye blinks while the page changes.
  const brand = useRef<HTMLAnchorElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const el = brand.current
    if (!el) return
    el.classList.remove('blink')
    void el.offsetWidth // restart the animation
    el.classList.add('blink')
    const id = setTimeout(() => el.classList.remove('blink'), 500)
    return () => clearTimeout(id)
  }, [pathname])

  const close = () => setOpen(false)

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Cursor />
      <Backdrop variant={backdropFor(pathname)} />
      <div className="proto-banner" role="note">
        <span className="micro">
          <b>Prototype</b> · research demo on public data · indicative, not an official assessment
        </span>
      </div>
      <header className="nav">
        <div className="container nav-inner">
          <Link ref={brand} to="/" className="brand" onClick={close} aria-label="PanoptiCoal home" viewTransition>
            <Wordmark animated />
          </Link>
          <button className="nav-toggle" aria-expanded={open} aria-controls="nav-links" onClick={() => setOpen((o) => !o)}>
            {open ? 'Close' : 'Menu'}
          </button>
          <nav id="nav-links" className={`nav-links${open ? ' open' : ''}`} aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} onClick={close} viewTransition>
                {l.label}
              </NavLink>
            ))}
            <a className="nav-gh" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub repository">
              <GitHubIcon />
            </a>
            <Link to="/map" className="pill magnetic" onClick={close} viewTransition>
              Explore the map <span className="arrow" aria-hidden="true">→</span>
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" ref={main}>
        <div className="page" key={pathname}>
          <Outlet />
        </div>
      </main>
      <footer className="footer">
        <BigWord speed={0.05}>Watching</BigWord>
        <div className="container layer footer-grid">
          <div>
            <Link to="/" className="brand" aria-label="PanoptiCoal home">
              <Wordmark />
            </Link>
            <p className="muted small" style={{ marginTop: 16, maxWidth: '40ch' }}>
              Coal plants report their own pollution. We watch from space. PanoptiCoal flags anomalies that warrant an
              audit, not proof of wrongdoing.
            </p>
          </div>
          <div>
            <div className="micro" style={{ marginBottom: 12 }}>
              Sources
            </div>
            <ul>
              <li>CEA daily generation reports · National Power Portal</li>
              <li>ESA Sentinel-5P TROPOMI (Copernicus)</li>
              <li>ECMWF ERA5 reanalysis</li>
              <li>Global Energy Monitor · Natural Earth</li>
              <li>Google Earth Engine</li>
            </ul>
          </div>
          <div>
            <div className="micro" style={{ marginBottom: 12 }}>
              Project
            </div>
            <ul>
              <li>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                  Source on GitHub ↗
                </a>
              </li>
              <li>
                <Link to="/how-it-works">How it works</Link>
              </li>
              <li>
                <Link to="/limits">Limits of this method</Link>
              </li>
              <li>
                <button type="button" className="linklike" onClick={() => navigate('/', { state: { replayIntro: Date.now() } })}>
                  Replay intro ↺
                </button>
              </li>
              <li>Basemap © Esri, © OpenStreetMap contributors</li>
            </ul>
          </div>
        </div>
      </footer>
    </>
  )
}
