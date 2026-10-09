import type { CSSProperties, ReactNode } from 'react'

// PanoptiCoal line icons: 24 px grid, 1.5 px stroke, round caps. Every stroke has pathLength=1 so the
// .icon.draw class can draw it in (stroke-dashoffset 1 -> 0) when the reveal observer adds .in.
export type IconName =
  | 'satellite' | 'plant' | 'wind' | 'cloud' | 'scan' | 'shield' | 'person' | 'chart'
  | 'eye' | 'doc' | 'pin' | 'grid' | 'car' | 'layers' | 'pulse'

const P = (d: string, i: number) => <path key={i} d={d} pathLength={1} style={{ '--i': i } as CSSProperties} />
const C = (cx: number, cy: number, r: number, i: number) => (
  <circle key={i} cx={cx} cy={cy} r={r} pathLength={1} style={{ '--i': i } as CSSProperties} />
)

const SHAPES: Record<IconName, ReactNode[]> = {
  // Body, two panels and an antenna, flying diagonally; two signal arcs below.
  satellite: [
    P('M10.4 8.6 L15.4 13.6 L13.6 15.4 L8.6 10.4 Z', 0),
    P('M8.2 6.8 L4.6 3.2 L2.8 5 L6.4 8.6 Z', 1),
    P('M17.6 15.8 L21.2 19.4 L19.4 21.2 L15.8 17.6 Z', 2),
    P('M7.3 7.7 L9.5 9.5 M14.5 14.5 L16.7 16.3', 3),
    P('M12.5 8.2 L15.2 5.5 M14.4 4.7 L16 6.3', 4),
    P('M4.5 14.5 a6 6 0 0 0 5 5 M3 17.8 a9 9 0 0 0 3.2 3.2', 5),
  ],
  // Turbine hall, two stacks and a rising plume.
  plant: [
    P('M2.5 21 H21.5', 0),
    P('M4 21 V13.5 L9 11 V13.5 L14 11 V21', 1),
    P('M15.5 21 V8.5 H18.5 V21', 2),
    P('M16.2 6.2 c-1.6-1 -0.6-2.6 1-2.4 c0.4-1.6 3-1.6 3.2 0.2 c1.4 0 1.8 1.8 0.6 2.4', 3),
    P('M6.5 17 H8 M10 17 H11.5', 4),
  ],
  wind: [
    P('M3 9 H14.5 a2.5 2.5 0 1 0 -2.5 -2.5', 0),
    P('M3 13 H18.5 a2.5 2.5 0 1 1 -2.5 2.5', 1),
    P('M3 17 H10', 2),
  ],
  cloud: [P('M7 18.5 H17.5 a4 4 0 0 0 0.6 -7.95 a5.5 5.5 0 0 0 -10.6 -1.3 A4.6 4.6 0 0 0 7 18.5 Z', 0), P('M9 21.5 H15', 1)],
  // Concentric measurement rings with a sweep.
  scan: [C(12, 12, 9, 0), C(12, 12, 5, 1), P('M12 12 L18.4 5.6', 2), C(12, 12, 1.2, 3)],
  shield: [P('M12 2.8 L19.5 5.6 V11.5 c0 4.6 -3.2 8 -7.5 9.7 c-4.3 -1.7 -7.5 -5.1 -7.5 -9.7 V5.6 Z', 0), P('M8.6 12 L11 14.4 L15.6 9.6', 1)],
  person: [C(12, 7.5, 3.5, 0), P('M4.5 20.5 c0.8 -4 3.8 -6.2 7.5 -6.2 s6.7 2.2 7.5 6.2', 1)],
  chart: [P('M3.5 3.5 V20.5 H20.5', 0), P('M6.5 15.5 L10.5 11 L13.5 13.5 L19 7', 1), C(19, 7, 1.2, 2), P('M6.5 18 H8 M10 18 H11.5 M13.5 18 H15', 3)],
  eye: [P('M2 12 C5.5 6 18.5 6 22 12 C18.5 18 5.5 18 2 12 Z', 0), C(12, 12, 4.2, 1), C(12, 12, 1.4, 2)],
  doc: [P('M6 2.8 H14.5 L19 7.3 V21.2 H6 Z', 0), P('M14.5 2.8 V7.3 H19', 1), P('M8.8 11.5 H16.2 M8.8 14.5 H16.2 M8.8 17.5 H13', 2)],
  pin: [P('M12 21.5 c-4-4.4 -6.5-8 -6.5-11.2 a6.5 6.5 0 0 1 13 0 c0 3.2 -2.5 6.8 -6.5 11.2 Z', 0), C(12, 10.3, 2.4, 1)],
  grid: [P('M3.5 3.5 H20.5 V20.5 H3.5 Z', 0), P('M9.2 3.5 V20.5 M14.8 3.5 V20.5 M3.5 9.2 H20.5 M3.5 14.8 H20.5', 1), C(12, 12, 1.6, 2)],
  car: [P('M3.5 16.5 V13 L5.6 8.5 H18.4 L20.5 13 V16.5 Z', 0), C(7.5, 17.5, 1.7, 1), C(16.5, 17.5, 1.7, 2), P('M3.5 13 H20.5', 3)],
  layers: [P('M12 3.5 L21 8.2 L12 12.9 L3 8.2 Z', 0), P('M3 12.2 L12 16.9 L21 12.2', 1), P('M3 16 L12 20.7 L21 16', 2)],
  pulse: [P('M2.5 12.5 H7 L9.2 6.5 L13 18 L15.4 10.5 L16.8 12.5 H21.5', 0)],
}

interface Props {
  name: IconName
  size?: number
  draw?: boolean // draw in on scroll (stroke animation)
  className?: string
  label?: string
}

export default function Icon({ name, size = 24, draw = true, className = '', label }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`icon ${draw ? 'draw' : ''} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {SHAPES[name]}
    </svg>
  )
}

// Icon in a small glowing tile.
export function IconTile({ name, tone = 'signal' }: { name: IconName; tone?: 'signal' | 'ember' }) {
  return (
    <span className={`icon-tile ${tone}`}>
      <Icon name={name} size={22} />
    </span>
  )
}
