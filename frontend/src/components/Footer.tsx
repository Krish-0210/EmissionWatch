import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GITHUB_URL } from '../lib/links'
import { useInView } from '../lib/motion'
import { Wordmark } from './Logo'
import MaskLines from './MaskLines'
import ScanWord from './ScanWord'
import SwapText from './SwapText'


// India time, minute resolution (the data and the plants are in IST).
function IstClock() {
  const fmt = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date())
  const [t, setT] = useState(fmt)
  useEffect(() => {
    const id = window.setInterval(() => setT(fmt()), 15000)
    return () => window.clearInterval(id)
  }, [])
  return <span className="mono">{t}</span>
}

// Footer: closing headline + CTAs, sources and project links (letters swap on hover), IST clock
// with the satellite's overpass time, a pointer-following glow and the scan-line wordmark that
// plays notes when you sweep across it.
export default function Footer() {
  const navigate = useNavigate()
  const head = useRef<HTMLDivElement>(null)
  const inView = useInView(head)
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el || !window.matchMedia('(pointer: fine)').matches) return
    const glow = el.querySelector<HTMLElement>('.footer-glow')
    const move = (e: PointerEvent) => {
      const b = el.getBoundingClientRect()
      if (glow) glow.style.transform = `translate3d(${(e.clientX - b.left - 300).toFixed(0)}px, ${(e.clientY - b.top - 300).toFixed(0)}px, 0)`
    }
    el.addEventListener('pointermove', move)
    return () => el.removeEventListener('pointermove', move)
  }, [])
  return (
    <footer ref={root} className="footer">
      <div className="footer-glow" aria-hidden="true" />
      <div ref={head} className={`container layer footer-top${inView ? ' in' : ''}`}>
        <div>
          <div className="micro signal">Keep watching</div>
          <h2 className="display d-lg" style={{ marginTop: 14 }}>
            <MaskLines lines={['Look where the', 'numbers drift.']} delay={60} />
          </h2>
        </div>
        <div className="footer-cta">
          <Link to="/map" className="pill">
            Explore the map <span className="arrow" aria-hidden="true">→</span>
          </Link>
          <Link to="/how-it-works" className="ulink">
            How the method works <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
      <div className="container layer footer-grid">
        <div>
          <Link to="/" className="brand" aria-label="PanoptiCoal home">
            <Wordmark />
          </Link>
          <p className="muted small" style={{ marginTop: 16, maxWidth: '40ch' }}>
            Coal plants report their own pollution. We watch from space. PanoptiCoal flags anomalies that warrant an audit,
            not proof of wrongdoing.
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
                <SwapText text="Source on GitHub ↗" />
              </a>
            </li>
            <li>
              <Link to="/how-it-works">
                <SwapText text="How it works" />
              </Link>
            </li>
            <li>
              <Link to="/limits">
                <SwapText text="Limits of this method" />
              </Link>
            </li>
            <li>
              <button type="button" className="linklike" onClick={() => navigate('/', { state: { replayIntro: Date.now() } })}>
                <SwapText text="Replay intro ↺" />
              </button>
            </li>
            <li>Basemap © Esri, © OpenStreetMap contributors</li>
          </ul>
        </div>
      </div>
      <div className="container layer footer-meta">
        <span className="micro">
          IST <IstClock /> · Sentinel-5P passes over at about 13:30 local time
        </span>
        <span className="micro footer-hint">
          <i aria-hidden="true" /> Sound on? Sweep across the scan lines
        </span>
      </div>
      <ScanWord text="Watching" />
    </footer>
  )
}
