import type Lenis from 'lenis'
import { prefersReducedMotion } from './motion'

// The page's Lenis instance (desktop with motion allowed; null on touch or reduced motion).
let lenis: Lenis | null = null
export const setLenis = (l: Lenis | null) => {
  lenis = l
}
export const getLenis = () => lenis

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Smooth scroll to a document y (Lenis when present, else native). Instant with reduced motion. */
export function scrollToY(y: number, duration = 1.2) {
  if (lenis) {
    lenis.scrollTo(y, { duration: prefersReducedMotion() ? 0 : duration, easing: easeInOutCubic, force: true, immediate: prefersReducedMotion() })
    return
  }
  window.scrollTo({ top: y, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

/** Jump to the top without animation (route changes). */
export function scrollTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true })
  else window.scrollTo(0, 0)
}
