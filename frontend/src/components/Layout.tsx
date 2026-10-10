import Lenis from 'lenis'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { backdropFor } from '../lib/backdrop'
import { setLenis } from '../lib/scroll'
import { gsap, ScrollTrigger } from '../lib/gsap'
import { useInteractions } from '../lib/interactions'
import { prefersReducedMotion } from '../lib/motion'
import { scramble } from '../lib/scramble'
import Backdrop from './Backdrop'
import Blinds from './Blinds'
import Cursor from './Cursor'
import Footer from './Footer'
import HoldFX from './HoldFX'
import PageTransition from './PageTransition'
import SoundToggle from './SoundToggle'
import SwapText from './SwapText'
import { Wordmark } from './Logo'


const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/map', label: 'Risk Map' },
  { to: '/near-me', label: 'Near Me' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/limits', label: 'Limits' },
]

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

const LOOPING = 'svg.il, svg.la, svg.pipe, svg.method-scene, svg.beacons, svg.rings-poster, .ticker'

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
    // Eyebrow labels decode (scramble into place) the first time they come into view.
    const sio = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            sio.unobserve(e.target)
            window.setTimeout(() => scramble(e.target, 700), 120)
          }
        }),
      { rootMargin: '0px 0px -8% 0px' },
    )
    // Graphics with looping CSS animations run only while on screen (an off-screen SVG animation still
    // repaints its layer every frame).
    const aio = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('anim-off', !e.isIntersecting)), { rootMargin: '80px 0px' })
    const seen = new WeakSet<Element>()
    const seenS = new WeakSet<Element>()
    const seenA = new WeakSet<Element>()
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
      if (!reduced)
        el.querySelectorAll('.micro.signal, .micro.ember, .sec-head .micro, .phero-eyebrow, [data-scramble]').forEach((n) => {
          if (!seenS.has(n)) {
            seenS.add(n)
            sio.observe(n)
          }
        })
      el.querySelectorAll(LOOPING).forEach((n) => {
        if (!seenA.has(n)) {
          seenA.add(n)
          aio.observe(n)
        }
      })
      para = Array.from(el.querySelectorAll<HTMLElement>('[data-parallax]'))
      dirty = true
    }
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(el, { childList: true, subtree: true })
    // Keyboard focus never lands on something still waiting for its entrance: reveal it now.
    const onFocus = (e: FocusEvent) => {
      for (let n = e.target as Element | null; n && n !== el; n = n.parentElement)
        if (n.matches('.reveal, .rule, .trig, .draw, .divider, .mask, .blur-in') && !n.classList.contains('in')) {
          n.classList.add('in', 'focus-in')
          io.unobserve(n)
        }
    }
    el.addEventListener('focusin', onFocus)

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
      sio.disconnect()
      aio.disconnect()
      mo.disconnect()
      el.removeEventListener('focusin', onFocus)
      window.removeEventListener('resize', onResize)
      gsap.ticker.remove(update)
    }
  }, [root, key])
}

// Thin bar under the nav: how far down the page you are.
function useScrollProgress(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    let last = -1
    const tick = () => {
      const el = ref.current
      if (!el) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      if (Math.abs(p - last) < 0.0005) return
      last = p
      el.style.transform = `scaleX(${p.toFixed(4)})`
    }
    gsap.ticker.add(tick)
    return () => gsap.ticker.remove(tick)
  }, [ref])
}

export default function Layout() {
  // Phone menu: open for the page it was opened on (navigation, including page transitions that
  // bypass the links' onClick, closes it).
  const [openAt, setOpenAt] = useState<string | null>(null)
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  useSmoothScroll()
  const progress = useRef<HTMLElement>(null)
  useScrollProgress(progress)
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

  const open = openAt === pathname
  const close = () => setOpenAt(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Menu open: page scroll locked, focus on the first link, Escape closes (focus back on the button).
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.style.overflow = 'hidden'
    lenis?.stop()
    // the menu starts under the bar, wherever the bar is (the prototype banner can push it down)
    const bar = document.querySelector('.nav')?.getBoundingClientRect()
    if (bar && menu.current) menu.current.style.paddingTop = `${Math.round(bar.bottom + 28)}px`
    menu.current?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenAt(null)
      toggle.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      root.style.overflow = ''
      lenis?.start()
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Cursor />
      <HoldFX />
      <PageTransition />
      <Backdrop variant={backdropFor(pathname)} />
      <div className="proto-banner" role="note">
        <span className="micro">
          <b>Prototype</b> · research demo on public data · indicative, not an official assessment
        </span>
      </div>
      <header className={`nav${open ? ' menu-open' : ''}`}>
        <div className="nav-inner">
          <Link ref={brand} to="/" className="brand" onClick={close} aria-label="PanoptiCoal home" viewTransition>
            <Wordmark animated />
          </Link>
          <nav className="nav-links" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} viewTransition>
                <SwapText text={l.label} />
              </NavLink>
            ))}
          </nav>
          <div className="nav-right">
            <Link to="/map" className="pill magnetic nav-cta" onClick={close} viewTransition>
              Explore the map <span className="arrow" aria-hidden="true">→</span>
            </Link>
            <SoundToggle className="nav-sound" />
            <button
              ref={toggle}
              type="button"
              className="nav-toggle"
              aria-expanded={open}
              aria-controls="nav-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpenAt((o) => (o === pathname ? null : pathname))}
            >
              <span className="nt-icon" aria-hidden="true">
                <i />
                <i />
              </span>
              <span aria-hidden="true">{open ? 'Close' : 'Menu'}</span>
            </button>
          </div>
        </div>
        <div className="scroll-progress" aria-hidden="true">
          <i ref={progress} />
        </div>
      </header>
      {/* Below 1024 px the links live in a full-screen menu */}
      <div ref={menu} id="nav-menu" className={`nav-menu${open ? ' open' : ''}`} inert={!open}>
        <nav className="nm-links" aria-label="Main menu">
          {LINKS.map((l, i) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="nm-link" onClick={close} style={{ '--i': i } as React.CSSProperties} viewTransition>
              <span className="nm-n">{String(i + 1).padStart(2, '0')}</span>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="nm-foot">
          <Link to="/map" className="pill" onClick={close} viewTransition>
            Explore the map <span className="arrow" aria-hidden="true">→</span>
          </Link>
          <p className="micro">Satellite NO₂ vs reported generation for India’s coal plant clusters.</p>
        </div>
      </div>
      <main id="main" ref={main}>
        <div className="page" key={pathname}>
          <Outlet />
        </div>
      </main>
      <Blinds className="to-footer" />
      <Footer />
    </>
  )
}
