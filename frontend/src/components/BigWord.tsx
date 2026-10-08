import type { CSSProperties } from 'react'

// Giant faded background word or number. data-parallax drives the slow drift (see Layout).
export default function BigWord({ children, style, speed = 0.15, className = '' }: { children: string; style?: CSSProperties; speed?: number; className?: string }) {
  return (
    <div className={`bigword ${className}`} style={style} data-parallax={speed} aria-hidden="true">
      {children}
    </div>
  )
}
