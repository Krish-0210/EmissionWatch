import { useEffect, useRef, type CSSProperties } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { gsap } from '../lib/gsap'
import { useReducedMotion } from '../lib/motion'
import { scramble } from '../lib/scramble'
import { sound } from '../lib/sound'

// Page transition: internal link clicks are intercepted; strips of uneven height close over the
// page out of order (0.45 s, with a whoosh), a viewfinder card names the destination, the route
// changes underneath, then the strips open upward to reveal the new page. Back/forward plays the
// reveal only. Links inside [data-transition="off"] (the Risk Map list, which flies the map first)
// and programmatic navigations keep their own behaviour. Off with reduced motion.
const N = 12
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 41.3 + k * 7.7) * 43758.5453
  return x - Math.floor(x)
}
const BARS = Array.from({ length: N }, (_, i) => 0.55 + rnd(i, 1) * 1.5)

function nameFor(path: string) {
  if (path === '/') return 'Home'
  if (path.startsWith('/map')) return 'Risk map'
  if (path.startsWith('/near-me')) return 'Near me'
  if (path.startsWith('/how-it-works')) return 'How it works'
  if (path.startsWith('/limits')) return 'Limits'
  const m = path.match(/^\/cluster\/([^/]+)/)
  if (m) return `Cluster · ${m[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
  return 'Page'
}

export default function PageTransition() {
  const navigate = useNavigate()
  const location = useLocation()
  const navType = useNavigationType()
  const reduced = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const name = useRef<HTMLSpanElement>(null)
  const busy = useRef(false)
  const ours = useRef(false) // the next location change was started here
  const first = useRef(true)

  const bars = () => Array.from(root.current?.querySelectorAll<HTMLElement>('.ptx-bar') ?? [])
  const card = () => root.current?.querySelector<HTMLElement>('.ptx-card') ?? null

  const reveal = (delay: number) => {
    const el = root.current
    if (!el) return
    gsap.to(card(), { opacity: 0, duration: 0.25, delay })
    gsap.to(bars(), {
      scaleY: 0,
      transformOrigin: '50% 0%',
      duration: 0.55,
      ease: 'power3.inOut',
      delay: delay + 0.05,
      stagger: { each: 0.035, from: 'random' },
      onComplete: () => {
        el.classList.remove('on')
        busy.current = false
      },
    })
  }

  // Click interception (capture, before the router's own handler).
  useEffect(() => {
    if (reduced) return
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]')
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.closest('[data-transition="off"]')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      const el = root.current
      if (busy.current || !el) return
      busy.current = true
      el.classList.add('on')
      if (name.current) {
        name.current.textContent = nameFor(url.pathname)
        scramble(name.current, 420)
      }
      sound.whoosh(0.85)
      gsap.set(bars(), { scaleY: 0, transformOrigin: '50% 100%' })
      gsap.fromTo(card(), { opacity: 0 }, { opacity: 1, duration: 0.25, delay: 0.22 })
      gsap.to(bars(), {
        scaleY: 1,
        duration: 0.45,
        ease: 'power3.inOut',
        stagger: { each: 0.03, from: 'random' },
        onComplete: () => {
          ours.current = true
          navigate(url.pathname + url.search + url.hash)
        },
      })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [navigate, reduced])

  // Route changed: finish our own transition, or play the reveal for back/forward.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (reduced) return
    if (ours.current) {
      ours.current = false
      reveal(0.28)
      return
    }
    if (navType === 'POP' && !busy.current && root.current) {
      busy.current = true
      root.current.classList.add('on')
      if (name.current) name.current.textContent = nameFor(location.pathname)
      gsap.set(bars(), { scaleY: 1 })
      gsap.set(card(), { opacity: 1 })
      sound.whoosh(0.6)
      reveal(0.18)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per location change
  }, [location.key])

  if (reduced) return null
  return (
    <div ref={root} className="ptx" aria-hidden="true">
      {BARS.map((h, i) => (
        <i key={i} className="ptx-bar" style={{ '--h': h } as CSSProperties} />
      ))}
      <div className="ptx-card">
        <i className="ptx-x ptx-tl" />
        <i className="ptx-x ptx-tr" />
        <i className="ptx-x ptx-br" />
        <i className="ptx-x ptx-bl" />
        <span className="micro signal">Retargeting</span>
        <span ref={name} className="ptx-name">
          Page
        </span>
      </div>
    </div>
  )
}
