import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthPoint } from '../api'
import { fmt } from '../lib/format'

const GEN = '#2a78d6'
const NO2 = '#eb6834'
const EXPECTED = '#4b5563'
const GRID = '#e3e5e9'
const AXIS = { fontSize: 12, fill: '#6b7280' }

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function No2Chart({ months }: { months: MonthPoint[] }) {
  const ticks = months.filter((m) => m.month.endsWith('-01')).map((m) => m.month)
  return (
    <div className="card chart-card">
      <h3>NO₂ near the plants: expected vs observed</h3>
      <p className="muted small">
        Monthly mean NO₂ enhancement (µmol/m², 20 km ring minus background). Expected = what reported generation and
        weather predict. Gaps are months without valid satellite days (mostly monsoon cloud).
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
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={months} syncId="cluster" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="month" ticks={ticks} tickFormatter={(m: string) => m.slice(0, 4)} tick={AXIS} />
          <YAxis tick={AXIS} width={44} />
          <Tooltip
            labelFormatter={(m) => monthLabel(String(m))}
            formatter={(v, name) => [`${fmt(v as number)} µmol/m²`, name]}
          />
          <Line
            name="Expected"
            dataKey="expected_no2"
            stroke={EXPECTED}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            name="Observed"
            dataKey="observed_no2"
            stroke={NO2}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function GenerationChart({ months }: { months: MonthPoint[] }) {
  const ticks = months.filter((m) => m.month.endsWith('-01')).map((m) => m.month)
  return (
    <div className="card chart-card">
      <h3>Reported electricity generation</h3>
      <p className="muted small">
        Monthly total, MU (GWh), from CEA daily reports. Blank where fewer than 90% of days were reported.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={months} syncId="cluster" margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="month" ticks={ticks} tickFormatter={(m: string) => m.slice(0, 4)} tick={AXIS} />
          <YAxis tick={AXIS} width={44} tickFormatter={(v: number) => v.toLocaleString('en-IN')} />
          <Tooltip
            labelFormatter={(m) => monthLabel(String(m))}
            formatter={(v) => [`${fmt(v as number, 0)} MU`, 'Generation']}
            cursor={{ fill: 'rgba(42,120,214,0.08)' }}
          />
          <Bar dataKey="generation_mu" name="Generation" fill={GEN} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
