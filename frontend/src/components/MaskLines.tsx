import type { CSSProperties } from 'react'

// Heading lines that rise one by one from a clipping mask when an ancestor (or the element itself)
// gets .in (the reveal observer in Layout, or a page's own trigger). Lines from `accentFrom` on take
// the accent colour. Screen readers get the plain sentence.
export default function MaskLines({
  lines,
  accentFrom = 1,
  tone = 'signal',
  delay = 0,
  step = 120,
}: {
  lines: string[]
  accentFrom?: number
  tone?: 'signal' | 'ember'
  delay?: number // ms before the first line
  step?: number // ms between lines
}) {
  return (
    <span className="mlines" style={{ '--md': `${delay}ms`, '--ms': `${step}ms` } as CSSProperties}>
      <span className="sr-only">{lines.join(' ')}</span>
      <span aria-hidden="true">
        {lines.map((l, i) => (
          <span key={i} className={`ml${i >= accentFrom ? ` acc ${tone}` : ''}`} style={{ '--l': i } as CSSProperties}>
            <span>{l}</span>
          </span>
        ))}
      </span>
    </span>
  )
}
