import { memo, type CSSProperties } from 'react'
import Icon, { type IconName } from './Icons'

// How It Works hero: the four steps as connected nodes on one data path. Packets of data flow
// along it (SMIL animateMotion); each node's ring pulses in turn; values come from the export.

export interface PipeStep {
  id: string
  label: string
  value: string
  icon: IconName
  tone?: 'signal' | 'ember'
}

const W = 440, H = 330
// 2 x 2, joined by an S: labels above the top pair and below the bottom pair keep the path clear.
const NODES = [
  { x: 104, y: 112 },
  { x: 336, y: 112 },
  { x: 104, y: 230 },
  { x: 336, y: 230 },
]
const PATH = 'M104 112 C 180 74, 260 74, 336 112 C 420 152, 20 190, 104 230 C 180 268, 260 268, 336 230'
const R = 27

const PipelineNodes = memo(function PipelineNodes({ steps }: { steps: PipeStep[] }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pipe" role="img" aria-label={`The method in four steps: ${steps.map((s) => `${s.label}, ${s.value}`).join('; ')}`}>
      <defs>
        <linearGradient id="pipe-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ce8d8" />
          <stop offset="0.65" stopColor="#7ce8d8" />
          <stop offset="1" stopColor="#ff8a3d" />
        </linearGradient>
        <radialGradient id="pipe-node" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#1a2632" />
          <stop offset="1" stopColor="#0a0f15" />
        </radialGradient>
      </defs>
      <path d={PATH} className="pipe-track" />
      <path d={PATH} className="pipe-flow" pathLength={1} />
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} r={i % 2 ? 2.2 : 3} className={`pipe-packet${i === 4 ? ' ember' : ''}`}>
          <animateMotion dur="5s" begin={`${i}s`} repeatCount="indefinite" path={PATH} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1" />
        </circle>
      ))}
      {steps.map((s, i) => {
        const n = NODES[i]
        const top = i < 2
        const ly = top ? n.y - R - 28 : n.y + R + 20
        return (
          <g key={s.id} className={`pipe-node ${s.tone ?? 'signal'}`} style={{ '--i': i } as CSSProperties}>
            <circle cx={n.x} cy={n.y} r={R + 10} className="pipe-wave" />
            <circle cx={n.x} cy={n.y} r={R} className="pipe-disc" />
            <circle cx={n.x} cy={n.y} r={R} className="pipe-ring" pathLength={1} />
            <svg x={n.x - 12} y={n.y - 12} width={24} height={24} className="pipe-ic">
              <Icon name={s.icon} size={24} draw={false} />
            </svg>
            <text x={n.x} y={ly} textAnchor="middle" className="pipe-label">
              {s.id} {s.label.toUpperCase()}
            </text>
            <text x={n.x} y={ly + 16} textAnchor="middle" className="pipe-value">
              {s.value}
            </text>
          </g>
        )
      })}
    </svg>
  )
})

export default PipelineNodes
