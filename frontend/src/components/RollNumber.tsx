import { useRef, type CSSProperties } from 'react'
import { useInView } from '../lib/motion'

// A figure whose digits roll into place like slot reels when it scrolls into view (other
// characters stay put). Screen readers get the plain text.
export default function RollNumber({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const go = useInView(ref)
  let n = 0
  return (
    <span ref={ref} className={`roll mono ${go ? 'go' : ''} ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {Array.from(text).map((c, i) =>
          /\d/.test(c) ? (
            <span key={i} className="rd" style={{ '--d': c, '--n': n++ } as CSSProperties}>
              <span className="rd-col">0123456789</span>
            </span>
          ) : (
            <span key={i} className="rs">
              {c}
            </span>
          ),
        )}
      </span>
    </span>
  )
}
