import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

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
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  const close = () => setOpen(false)

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="proto-banner" role="note">
        <strong>Prototype.</strong> Research demo built on public data; results are indicative and not an official
        assessment.
      </div>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            EmissionWatch
          </Link>
          <button
            className="nav-toggle"
            aria-expanded={open}
            aria-controls="nav-links"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
          <nav id="nav-links" className={`nav-links${open ? ' open' : ''}`} aria-label="Main">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} onClick={close}>
                {l.label}
              </NavLink>
            ))}
            <a className="nav-gh" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub repository">
              <GitHubIcon />
            </a>
            <Link to="/map" className="btn btn-primary" onClick={close}>
              Explore the map
            </Link>
          </nav>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <div>
            <strong>EmissionWatch</strong>
            <br />
            Satellite-verified accountability for Indian coal plants.
          </div>
          <div>
            Data: CEA / National Power Portal, ESA Sentinel-5P (Copernicus), ECMWF ERA5, Global Energy Monitor.
            <br />
            Processed with Google Earth Engine. Map tiles © OpenStreetMap contributors.
          </div>
          <div>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
            <br />
            <Link to="/limits">Limits of this method</Link>
          </div>
        </div>
      </footer>
    </>
  )
}
