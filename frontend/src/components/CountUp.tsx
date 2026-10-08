import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion, useInView } from '../lib/motion'

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
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!go) return
    if (prefersReducedMotion()) {
      const id = requestAnimationFrame(() => setShown(value))
      return () => cancelAnimationFrame(id)
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration)
      setShown(value * (1 - Math.pow(1 - k, 4)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [go, value, duration])

  return (
    <span ref={ref} className={`mono ${className ?? ''}`}>
      <span className="sr-only">{`${prefix}${format(value, decimals, 0)}${suffix}`}</span>
      <span aria-hidden="true">
        {prefix}
        {format(shown, decimals, pad)}
        {suffix}
      </span>
    </span>
  )
}
