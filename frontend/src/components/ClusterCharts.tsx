import { startTransition, useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthPoint } from '../api'
import { fmt } from '../lib/format'
import { useReducedMotion } from '../lib/motion'

const GEN = '#2a78d6'
const NO2 = '#ff8a3d'
const EXPECTED = '#7ce8d8'
const GRID = '#1c232b'
const AXIS = { fontSize: 11, fill: '#8a96a3', fontFamily: 'JetBrains Mono, monospace' }

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

// One tooltip for both charts (they share syncId): the whole month at a glance.
function MonthTip({ active, payload }: { active?: boolean; payload?: { payload: MonthPoint }[] }) {
  const m = payload?.[0]?.payload
  if (!active || !m) return null
  const r = m.residual
  return (
    <div className="ctip">
      <div className="ctip-head micro">{monthLabel(m.month)}</div>
      <dl>
        <dt>
          <i style={{ background: NO2 }} />
          Observed NO₂
        </dt>
        <dd className="mono">{m.observed_no2 == null ? 'no valid days' : `${fmt(m.observed_no2)} µmol/m²`}</dd>
        <dt>
          <i style={{ background: EXPECTED }} />
          Expected
        </dt>
        <dd className="mono">{m.expected_no2 == null ? '–' : `${fmt(m.expected_no2)} µmol/m²`}</dd>
        <dt>Residual</dt>
        <dd className={`mono ${r == null ? '' : r > 0 ? 'up' : 'down'}`}>{r == null ? '–' : `${r > 0 ? '+' : ''}${fmt(r)} ${r > 0 ? '▲' : '▼'}`}</dd>
        <dt>
          <i style={{ background: GEN }} />
          Generation
        </dt>
        <dd className="mono">{m.generation_mu == null ? 'under 90% reported' : `${fmt(m.generation_mu, 0)} MU`}</dd>
        <dt>Valid satellite days</dt>
        <dd className="mono">{m.valid_fraction == null ? '–' : `${Math.round(m.valid_fraction * 100)}%`}</dd>
      </dl>
    </div>
  )
}

// Charts mount while the browser is idle after the page loads (or as they come near the viewport,
// whichever is first), as a transition so React renders them in slices: mounting Recharts during a
// scroll cost 40-80 ms frames. A chart that is on screen when it mounts draws its lines in.
type Idle = { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
function useDrawIn() {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState({ show: false, onScreen: false })
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let done = false
    const mount = () => {
      if (done) return
      done = true
      io.disconnect()
      const r = el.getBoundingClientRect()
      const onScreen = r.top < window.innerHeight && r.bottom > 0
      startTransition(() => setState({ show: true, onScreen }))
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && mount(), { rootMargin: '0px 0px 25% 0px' })
    io.observe(el)
    const w = window as Idle
    const id = w.requestIdleCallback ? w.requestIdleCallback(mount, { timeout: 2500 }) : window.setTimeout(mount, 1200)
    return () => {
      done = true
      io.disconnect()
      if (w.cancelIdleCallback) w.cancelIdleCallback(id)
      else window.clearTimeout(id)
    }
  }, [])
  return { ref, show: state.show, animate: !reduced && state.onScreen }
}

export function No2Chart({ months }: { months: MonthPoint[] }) {
  const ticks = months.filter((m) => m.month.endsWith('-01')).map((m) => m.month)
  const { ref, show, animate } = useDrawIn()
  return (
    <div className="card chart-card" ref={ref}>
      <div className="micro">
        NO₂ enhancement · <span className="nocase">µmol/m²</span> · monthly
      </div>
      <h3>Expected vs observed</h3>
      <p className="muted small">
        20 km ring minus background. Expected = what reported generation and weather predict. Gaps are months without
        valid satellite days (mostly monsoon cloud).
      </p>
      <div className="chart-legend">
        <span>
          <i style={{ borderColor: NO2 }} />
          Observed
        </span>
        <span>
          <i style={{ borderColor: EXPECTED, borderTopStyle: 'dashed' }} />
          Expected
        </span>
      </div>
      <div className="chart-area" style={{ height: 300 }}>
        {show && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={months} syncId="cluster" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" ticks={ticks} tickFormatter={(m: string) => m.slice(0, 4)} tick={AXIS} stroke={GRID} />
              <YAxis tick={AXIS} width={40} stroke={GRID} />
              <Tooltip content={<MonthTip />} cursor={{ stroke: '#7ce8d8', strokeOpacity: 0.35 }} />
              <Line name="Expected" dataKey="expected_no2" stroke={EXPECTED} strokeWidth={1.6} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={animate} animationDuration={1600} />
              <Line name="Observed" dataKey="observed_no2" stroke={NO2} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: NO2, stroke: '#07090c', strokeWidth: 2 }} connectNulls={false} isAnimationActive={animate} animationDuration={1900} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

export function ResidualChart({ months }: { months: MonthPoint[] }) {
  const ticks = months.filter((m) => m.month.endsWith('-01')).map((m) => m.month)
  const { ref, show, animate } = useDrawIn()
  return (
    <div className="card chart-card" ref={ref}>
      <div className="micro">
        Residual · observed − expected · <span className="nocase">µmol/m²</span>
      </div>
      <h3>Above or below what reports explain</h3>
      <p className="muted small">Bars above zero: more NO₂ than reported generation and weather predict that month.</p>
      <div className="chart-area" style={{ height: 200 }}>
        {show && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months} syncId="cluster" margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" ticks={ticks} tickFormatter={(m: string) => m.slice(0, 4)} tick={AXIS} stroke={GRID} />
              <YAxis tick={AXIS} width={40} stroke={GRID} />
              <ReferenceLine y={0} stroke="#2a333d" />
              <Tooltip content={<MonthTip />} cursor={{ fill: 'rgba(124,232,216,0.06)' }} />
              <Bar dataKey="residual" name="Residual" isAnimationActive={animate} animationDuration={1200} shape={ResidualBar} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// Bars coloured by sign (ember above, teal below), 2 px rounded at the data end.
function ResidualBar(p: { x?: number; y?: number; width?: number; height?: number; payload?: MonthPoint }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = p
  const up = (payload?.residual ?? 0) > 0
  return <rect x={x} y={height < 0 ? y + height : y} width={Math.max(1, width)} height={Math.abs(height)} rx={1} fill={up ? NO2 : EXPECTED} opacity={0.85} />
}

export function GenerationChart({ months }: { months: MonthPoint[] }) {
  const ticks = months.filter((m) => m.month.endsWith('-01')).map((m) => m.month)
  const { ref, show, animate } = useDrawIn()
  return (
    <div className="card chart-card" ref={ref}>
      <div className="micro">Reported generation · MU (GWh) · monthly</div>
      <h3>What the plants reported</h3>
      <p className="muted small">From CEA daily reports. Blank where fewer than 90% of days were reported.</p>
      <div className="chart-area" style={{ height: 220 }}>
        {show && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months} syncId="cluster" margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="month" ticks={ticks} tickFormatter={(m: string) => m.slice(0, 4)} tick={AXIS} stroke={GRID} />
              <YAxis tick={AXIS} width={40} stroke={GRID} tickFormatter={(v: number) => v.toLocaleString('en-IN')} />
              <Tooltip content={<MonthTip />} cursor={{ fill: 'rgba(42,120,214,0.1)' }} />
              <Bar dataKey="generation_mu" name="Generation" fill={GEN} radius={[2, 2, 0, 0]} isAnimationActive={animate} animationDuration={1200} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

export default function ClusterCharts({ months }: { months: MonthPoint[] }) {
  return (
    <div className="grid">
      <No2Chart months={months} />
      <ResidualChart months={months} />
      <GenerationChart months={months} />
    </div>
  )
}
