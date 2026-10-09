import { useEffect, useRef, type CSSProperties } from 'react'
import { ScrollTrigger } from '../lib/gsap'
import { prefersReducedMotion } from '../lib/motion'

// Statement whose words light up one after another as it scrolls through the viewport (scrubbed,
// so scrolling back dims them again). Words wrapped in *asterisks* take the ember accent.
export default function ScrubText({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const words = text.split(/\s+/)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion()) {
      el.style.setProperty('--k', String(words.length + 2))
      return
    }
    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top 82%',
      end: 'bottom 42%',
      onUpdate: (s) => el.style.setProperty('--k', (s.progress * (words.length + 3)).toFixed(2)),
    })
    el.style.setProperty('--k', (st.progress * (words.length + 3)).toFixed(2))
    return () => st.kill()
  }, [words.length])
  return (
    <p ref={ref} className={`scrub display ${className}`}>
      <span className="sr-only">{text.replace(/\*/g, '')}</span>
      <span aria-hidden="true">
        {words.map((w, i) => (
          <span key={i} className={`sw${w.includes('*') ? ' acc' : ''}`} style={{ '--i': i } as CSSProperties}>
            {w.replace(/\*/g, '')}{' '}
          </span>
        ))}
      </span>
    </p>
  )
}
