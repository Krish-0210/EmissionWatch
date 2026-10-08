import { Link } from 'react-router-dom'

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

export default function Limits() {
  return (
    <div className="container section">
      <div className="prose">
        <h1>Limits</h1>
        <p className="lede">
          EmissionWatch is a screening tool. It points inspectors to where a closer look is most likely to be useful.
          Here is what it cannot do.
        </p>
      </div>
      <div className="grid grid-2" style={{ marginTop: 24 }}>
        {LIMITS.map((l, i) => (
          <div className="card limit" key={l.title}>
            <span className="ic" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <h3>{l.title}</h3>
              <p>{l.body}</p>
            </div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 24 }}>
        <Link to="/how-it-works">How the method works →</Link>
      </p>
    </div>
  )
}
