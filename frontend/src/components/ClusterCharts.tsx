import { useRef } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthPoint } from '../api'
import { fmt } from '../lib/format'
import { useInView, useReducedMotion } from '../lib/motion'

const GEN = '#2a78d6'
const NO2 = '#ff8a3d'
const EXPECTED = '#7ce8d8'
const GRID = '#1c232b'
const AXIS = { fontSize: 11, fill: '#8a96a3', fontFamily: 'JetBrains Mono, monospace' }
const TIP = {
  contentStyle: { background: '#0e1217', border: '1px solid #2a333d', borderRadius: 10, fontSize: 13 },
  labelStyle: { color: '#8a96a3', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, textTransform: 'uppercase' as const },
  itemStyle: { color: '#e8edf2' },
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

// Charts mount (and animate in) once scrolled into view.
function useDrawIn() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const reduced = useReducedMotion()
  return { ref, show: inView, animate: !reduced }
}

export function No2Chart({ months }: { months: MonthPoint[] }) {
  const ticks = months.filter((m) => m.month.endsWith('-01')).map((m) => m.month)
  const { ref, show, animate } = useDrawIn()
  return (
    <div className="card chart-card" ref={ref}>
      <div className="micro">NO₂ enhancement · <span className="nocase">µmol/m²</span> · monthly</div>
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
              <Tooltip {...TIP} cursor={{ stroke: '#2a333d' }} labelFormatter={(m) => monthLabel(String(m))} formatter={(v, name) => [`${fmt(v as number)} µmol/m²`, name]} />
              <Line name="Expected" dataKey="expected_no2" stroke={EXPECTED} strokeWidth={1.6} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={animate} animationDuration={1600} />
              <Line name="Observed" dataKey="observed_no2" stroke={NO2} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: NO2 }} connectNulls={false} isAnimationActive={animate} animationDuration={1900} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
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
              <Tooltip {...TIP} labelFormatter={(m) => monthLabel(String(m))} formatter={(v) => [`${fmt(v as number, 0)} MU`, 'Generation']} cursor={{ fill: 'rgba(42,120,214,0.1)' }} />
              <Bar dataKey="generation_mu" name="Generation" fill={GEN} radius={[2, 2, 0, 0]} isAnimationActive={animate} animationDuration={1200} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
