import { useEffect, useRef } from 'react'
import { prefersReducedMotion, setText, useInView } from '../lib/motion'

interface Props {
  value: number
  decimals?: number
  duration?: number
  pad?: number // zero-pad integer part to this many digits
  prefix?: string
  suffix?: string
  className?: string
  start?: boolean // override in-view trigger
}

const format = (x: number, decimals: number, pad: number) => {
  const s = x.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return pad ? s.padStart(pad, '0') : s
}

// Counts up from 0 when scrolled into view (or when `start` turns true).
export default function CountUp({ value, decimals = 0, duration = 1600, pad = 0, prefix = '', suffix = '', className, start }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref)
  const go = start ?? inView
  const out = useRef<HTMLSpanElement>(null)

  // Writes the text node directly each frame; no React state while counting.
  useEffect(() => {
    const el = out.current
    if (!go || !el) return
    const show = (x: number) => {
      setText(el, `${prefix}${format(x, decimals, pad)}${suffix}`)
    }
    if (prefersReducedMotion()) {
      show(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration)
      show(value * (1 - Math.pow(1 - k, 4)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [go, value, duration, decimals, pad, prefix, suffix])

  return (
    <span ref={ref} className={`mono ${className ?? ''}`}>
      <span className="sr-only">{`${prefix}${format(value, decimals, 0)}${suffix}`}</span>
      <span ref={out} aria-hidden="true">
        {`${prefix}${format(0, decimals, pad)}${suffix}`}
      </span>
    </span>
  )
}
