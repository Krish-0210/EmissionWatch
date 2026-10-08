import { Link } from 'react-router-dom'

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

const STEPS = [
  {
    title: 'Read what plants report',
    body: 'Daily electricity generation for each plant, from the Central Electricity Authority’s public reports.',
  },
  {
    title: 'Measure from space',
    body: 'The Sentinel-5P satellite measures NO₂ over every plant cluster each day. We compare it with the air 50–80 km away.',
  },
  {
    title: 'Flag what doesn’t add up',
    body: 'A model predicts the NO₂ that reported generation and weather should produce. Sustained excess raises the risk score.',
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

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="eyebrow">Satellite-verified accountability</p>
          <h1>Coal plants report their own pollution. We check it from space.</h1>
          <p className="lede">
            EmissionWatch compares daily satellite measurements of nitrogen dioxide around India’s largest coal
            plant clusters with the electricity they report generating, and flags where the two stop matching.
          </p>
          <div className="btn-row">
            <Link to="/map" className="btn btn-primary">
              Explore the map
            </Link>
            <Link to="/near-me" className="btn btn-secondary">
              Find plants near me
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <p className="eyebrow">The problem</p>
          <h2>Emissions oversight runs on trust</h2>
          <div className="grid grid-3" style={{ marginTop: 24 }}>
            {PROBLEMS.map((p) => (
              <div className="card" key={p.title}>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <p className="eyebrow">How it works</p>
          <h2>Three steps, all from public data</h2>
          <div className="grid grid-3" style={{ marginTop: 24 }}>
            {STEPS.map((s, i) => (
              <div className="card" key={s.title}>
                <span className="step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 20 }}>
            <Link to="/how-it-works">Read the full method →</Link>
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <p className="eyebrow">Who it’s for</p>
          <h2>Built for the people who act on it</h2>
          <div className="grid grid-3" style={{ marginTop: 24 }}>
            {AUDIENCES.map((a) => (
              <div className="card" key={a.title}>
                <h3>{a.title}</h3>
                <p>{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt" aria-label="Key numbers">
        <div className="container stats-strip">
          <div className="stat">
            <div className="num">11</div>
            <div className="lbl">coal plant clusters</div>
          </div>
          <div className="stat">
            <div className="num">2019–2026</div>
            <div className="lbl">years of data</div>
          </div>
          <div className="stat">
            <div className="num">~2,800</div>
            <div className="lbl">daily generation reports</div>
          </div>
          <div className="stat">
            <div className="num">Daily</div>
            <div className="lbl">satellite NO₂ measurements</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="note">
            <h3>Honest by design</h3>
            <p>
              EmissionWatch highlights anomalies that warrant an audit, not proof of wrongdoing. Satellite pixels
              are coarse, clouds hide the monsoon months, and other sources also emit NO₂. Every score comes with a
              confidence level and the reasons behind it. <Link to="/limits">See the limits</Link>.
            </p>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <p className="eyebrow">Data sources</p>
          <ul className="sources">
            {SOURCES.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
