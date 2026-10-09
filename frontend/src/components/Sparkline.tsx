import { memo, useId } from 'react'
import type { MonthPoint } from '../api'

// Monthly NO2 residual (observed − expected): ember above zero, teal below. Gaps where no valid data.
// Draws in when an ancestor gets .in (reveal); `pathLength` makes the stroke animation size-free.
function Sparkline({ months, w = 140, h = 34, label }: { months: MonthPoint[]; w?: number; h?: number; label?: string }) {
  const vals = months.map((m) => m.residual)
  const max = Math.max(1, ...vals.map((v) => Math.abs(v ?? 0)))
  const x = (i: number) => (i / Math.max(1, months.length - 1)) * w
  const y = (v: number) => h / 2 - (v / max) * (h / 2 - 2)
  let d = ''
  let pen = false
  vals.forEach((v, i) => {
    if (v == null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  })
  const id = `sp${useId().replace(/[^\w-]/g, '')}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="spark" role="img" aria-label={label ?? 'Monthly NO₂ residual'}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2={h} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff8a3d" />
          <stop offset="0.5" stopColor="#ff8a3d" />
          <stop offset="0.5" stopColor="#7ce8d8" />
          <stop offset="1" stopColor="#7ce8d8" />
        </linearGradient>
      </defs>
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="spark-zero" />
      <path d={d} pathLength={1} className="spark-line" stroke={`url(#${id})`} />
    </svg>
  )
}

export default memo(Sparkline)
