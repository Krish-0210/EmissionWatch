import type { CSSProperties } from 'react'

// Link label that swaps on hover: its letters blur away one after another while an identical copy
// blurs in behind them (CSS in styles/fx.css, triggered by hovering or focusing the parent link).
export default function SwapText({ text }: { text: string }) {
  const chars = (copy: number) =>
    Array.from(text).map((c, i) => (
      <span key={`${copy}${i}`} className="sw-c" style={{ '--i': i } as CSSProperties}>
        {c === ' ' ? ' ' : c}
      </span>
    ))
  return (
    <span className="swap">
      <span className="sr-only">{text}</span>
      <span className="sw-a" aria-hidden="true">
        {chars(0)}
      </span>
      <span className="sw-b" aria-hidden="true">
        {chars(1)}
      </span>
    </span>
  )
}
