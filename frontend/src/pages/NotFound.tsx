import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="container section">
      <div className="micro signal">Error 404</div>
      <h1 className="display d-lg" style={{ margin: '14px 0 18px' }}>
        Page not found.
      </h1>
      <p className="lede">This address does not match a PanoptiCoal page. Pick where to go next.</p>
      <div className="row" style={{ marginTop: 26 }}>
        <Link to="/" className="pill" viewTransition>
          Home <span className="arrow" aria-hidden="true">→</span>
        </Link>
        <Link to="/map" className="ulink" viewTransition>
          Risk map <span className="arrow" aria-hidden="true">→</span>
        </Link>
        <Link to="/near-me" className="ulink" viewTransition>
          Coal plants near me <span className="arrow" aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  )
}
