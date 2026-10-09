import { gsap } from './gsap'
import { prefersReducedMotion } from './motion'

// Smoothed scroll velocity (px per frame at 60 Hz, signed), shared by the marquees and the
// velocity skew on registered elements (skewY in degrees = velocity × data-skew, clamped).
let v = 0
let lastY = typeof window !== 'undefined' ? window.scrollY : 0
let users = 0
const skewed = new Set<HTMLElement>()

const tick = (_t: number, dt: number) => {
  const y = window.scrollY
  const raw = ((y - lastY) / Math.max(1, dt)) * 16.67
  lastY = y
  v += (raw - v) * 0.18
  if (Math.abs(v) < 0.01) v = 0
  for (const el of skewed) {
    const k = Number(el.dataset.skew) || 0.12
    const s = Math.max(-5, Math.min(5, v * k))
    el.style.transform = Math.abs(s) > 0.01 ? `skewY(${s.toFixed(2)}deg)` : ''
  }
}

export const scrollVelocity = () => v

/** Start the velocity tracker while at least one consumer is running. Returns a stop function. */
export function startVelocity() {
  users++
  if (users === 1 && !prefersReducedMotion()) {
    lastY = window.scrollY
    gsap.ticker.add(tick)
  }
  return () => {
    users--
    if (users === 0) gsap.ticker.remove(tick)
  }
}

/** Velocity skew for an element (off with reduced motion). Returns a cleanup. */
export function addSkew(el: HTMLElement) {
  if (prefersReducedMotion()) return () => {}
  skewed.add(el)
  const stop = startVelocity()
  return () => {
    skewed.delete(el)
    el.style.transform = ''
    stop()
  }
}
