import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Confidence, RiskLevel, TimeseriesFile } from '../api'
import { fetchCluster, fetchClusters, fetchTimeseries, peekClusters } from '../api'
import { ConfidenceBadge, RiskBadge } from '../components/Badges'
import ClusterMap from '../components/ClusterMap'
import CountUp from '../components/CountUp'
import Icon from '../components/Icons'
import PageHero, { Divider, type TickerItem } from '../components/PageHero'
import RiskBeacons from '../components/RiskBeacons'
import Sparkline from '../components/Sparkline'
import { useFlip } from '../lib/flip'
import { CONF_LABEL, RISK_COLOR, RISK_LABEL } from '../lib/format'
import { prefersReducedMotion } from '../lib/motion'
import { scrollToY } from '../lib/scroll'
import { useAsync } from '../lib/useAsync'
import './riskmap.css'

const LEVELS: RiskLevel[] = ['high', 'medium', 'low']
const CONFS: Confidence[] = ['high', 'medium', 'low']

function Chip({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button type="button" className={`fchip ripple${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} style={color ? ({ '--c': color } as CSSProperties) : undefined}>
      {color && <i aria-hidden="true" />}
      {children}
    </button>
  )
}

export default function RiskMap() {
  const { data, error } = useAsync(fetchClusters, [], peekClusters)
  const [hover, setHover] = useState<string>()
  const [flying, setFlying] = useState<string>()
  const [level, setLevel] = useState<RiskLevel | 'all'>('all')
  const [conf, setConf] = useState<Confidence | 'all'>('all')
  const [state, setState] = useState<string>('all')
  const [series, setSeries] = useState<Record<string, TimeseriesFile>>({})
  const navigate = useNavigate()
  const list = useRef<HTMLOListElement>(null)
  const capture = useFlip(list, [level, conf, state])

  // Residual sparklines: the 11 small time-series files, fetched once the list is up.
  useEffect(() => {
    if (!data) return
    let live = true
    Promise.all(data.clusters.map((c) => fetchTimeseries(c.id).catch(() => undefined))).then((all) => {
      if (live) setSeries(Object.fromEntries(all.filter(Boolean).map((t) => [t!.id, t!])))
    })
    return () => {
      live = false
    }
  }, [data])

  const select = (id: string) => {
    void fetchCluster(id) // warm the cache so the cluster page renders its title on the first frame
    if (prefersReducedMotion()) navigate(`/cluster/${id}`)
    else setFlying(id)
  }
  const arrive = useCallback(() => {
    if (flying) navigate(`/cluster/${flying}`, { viewTransition: true })
  }, [flying, navigate])

  const states = useMemo(() => [...new Set((data?.clusters ?? []).flatMap((c) => c.states))].sort(), [data])
  const ranked = useMemo(() => (data ? [...data.clusters].sort((a, b) => b.risk_score - a.risk_score) : []), [data])
  const shown = ranked.filter((c) => (level === 'all' || c.risk_level === level) && (conf === 'all' || c.confidence === conf) && (state === 'all' || c.states.includes(state)))
  const dimmed = useMemo(() => new Set(ranked.filter((c) => !shown.includes(c)).map((c) => c.id)), [ranked, shown])
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    capture()
    set(v)
  }

  const ticker: TickerItem[] = useMemo(
    () =>
      data
        ? [
            { label: 'Data as of', value: data.as_of },
            ...ranked.map((c) => ({ label: c.name, value: `${Math.round(c.risk_score)} · ${c.risk_level}`, color: RISK_COLOR[c.risk_level] })),
            { label: 'Scale', value: '0–100 · <40 low · <65 medium' },
          ]
        : [],
    [data, ranked],
  )

  if (error)
    return (
      <div className="container section">
        <div className="alert err">Could not load clusters: {error}</div>
      </div>
    )
  if (!data) return <div className="container loading micro">Loading clusters…</div>

  const target = data.clusters.find((c) => c.id === flying)
  const counts = Object.fromEntries(LEVELS.map((l) => [l, data.clusters.filter((c) => c.risk_level === l).length])) as Record<RiskLevel, number>

  return (
    <div className="riskmap">
      <PageHero
        eyebrow={
          <>
            <Icon name="scan" size={18} /> Audit risk map · data as of {data.as_of}
          </>
        }
        title={`${data.clusters.length} clusters.`}
        dim="One score each."
        lede="Scored 0–100 on how far satellite NO₂ departs from what reported generation and weather predict. Filter, compare, then select a cluster to fly in."
        word="Map"
        visual={<RiskBeacons clusters={data.clusters} />}
        ticker={ticker}
      >
        <div className="row">
          <button
            type="button"
            className="pill magnetic"
            onClick={() => {
              const el = document.getElementById('explore')
              if (el) scrollToY(el.getBoundingClientRect().top + window.scrollY - 88, 0.9)
            }}
          >
            Filter and explore <span className="arrow" aria-hidden="true">↓</span>
          </button>
          <Link to="/near-me" className="ulink" viewTransition>
            Coal plants near me <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </PageHero>

      <div className="container layer section-tight" id="explore">
        <div className="filters reveal" role="group" aria-label="Filter clusters">
          <div className="fgroup">
            <span className="micro">Risk</span>
            <Chip on={level === 'all'} onClick={() => filter(setLevel)('all')}>
              All
            </Chip>
            {LEVELS.map((l) => (
              <Chip key={l} on={level === l} onClick={() => filter(setLevel)(l)} color={RISK_COLOR[l]}>
                {l} · {counts[l]}
              </Chip>
            ))}
          </div>
          <div className="fgroup">
            <span className="micro">Confidence</span>
            <Chip on={conf === 'all'} onClick={() => filter(setConf)('all')}>
              All
            </Chip>
            {CONFS.map((l) => (
              <Chip key={l} on={conf === l} onClick={() => filter(setConf)(l)}>
                {l}
              </Chip>
            ))}
          </div>
          <div className="fgroup">
            <label className="micro" htmlFor="state-filter">
              State
            </label>
            <select id="state-filter" className="fselect" value={state} onChange={(e) => filter(setState)(e.target.value)}>
              <option value="all">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="map-layout">
          <div className="reveal" style={{ '--d': '120ms' } as CSSProperties}>
            <div className="map-frame">
              <div className="map-box">
                <ClusterMap clusters={data.clusters} highlight={hover ?? flying} dimmed={dimmed} onHover={setHover} onSelect={select} flyTo={target} onArrive={arrive} />
              </div>
            </div>
            <div className="legend" aria-label="Legend">
              {LEVELS.map((l, i) => (
                <span key={l} className="legend-item" style={{ '--c': RISK_COLOR[l], '--i': i } as CSSProperties}>
                  <i aria-hidden="true" />
                  {RISK_LABEL[l]} <b className="mono">{counts[l]}</b>
                </span>
              ))}
              <span className="micro">Ring size = installed capacity · pulse speed = risk</span>
            </div>
          </div>

          <div>
            <div className="micro list-head" aria-live="polite">
              Ranked by risk score · showing {shown.length} of {data.clusters.length}
            </div>
            <ol className="rank-list spot-group" ref={list}>
              {shown.map((c) => (
                <li key={c.id} data-flip={c.id}>
                  <Link
                    to={`/cluster/${c.id}`}
                    data-transition="off"
                    className={`rank-item card tilt${hover === c.id || flying === c.id ? ' hl' : ''}`}
                    data-tilt="3"
                    style={{ '--rc': RISK_COLOR[c.risk_level] } as CSSProperties}
                    onMouseEnter={() => {
                      setHover(c.id)
                      void fetchCluster(c.id)
                    }}
                    onMouseLeave={() => setHover(undefined)}
                    onFocus={() => setHover(c.id)}
                    onBlur={() => setHover(undefined)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return
                      e.preventDefault()
                      select(c.id)
                    }}
                  >
                    <span className="rank-pos mono">{String(ranked.indexOf(c) + 1).padStart(2, '0')}</span>
                    <span className="rank-body">
                      <span className="rank-name" style={{ viewTransitionName: `ct-${c.id}` } as CSSProperties}>
                        {c.name}
                      </span>
                      <span className="micro"> {c.states.join(' · ')}</span>
                      <span className="row" style={{ gap: 6, marginTop: 8 }}>
                        <RiskBadge level={c.risk_level} />
                        <ConfidenceBadge confidence={c.confidence} />
                      </span>
                    </span>
                    <span className="rank-score">
                      <CountUp value={Math.round(c.risk_score)} duration={1200} className="n" />
                      <span className="micro">/100</span>
                    </span>
                    <span className="rank-spark">
                      {series[c.id] ? (
                        <Sparkline months={series[c.id].months} w={260} h={30} label={`${c.name}: monthly NO₂ residual, ${CONF_LABEL[c.confidence].toLowerCase()}`} />
                      ) : (
                        <span className="spark-skel" />
                      )}
                      <span className="micro spark-cap">NO₂ residual · monthly · above / below expected</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            {!shown.length && <p className="muted small">No cluster matches these filters.</p>}
          </div>
        </div>
        <Divider />
      </div>
    </div>
  )
}
