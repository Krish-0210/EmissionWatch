import { useEffect, useState, type RefObject } from 'react'

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')
export const useIsMobile = () => useMediaQuery('(max-width: 767px)')
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// True while (or once, with once=true) the element intersects the viewport.
export function useInView(ref: RefObject<Element | null>, { once = true, rootMargin = '0px 0px -12% 0px' } = {}) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true)
          if (once) io.disconnect()
        } else if (!once) setInView(false)
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, once, rootMargin])
  return inView
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
// Progress of x through [a, b], clamped to 0..1.
export const span = (x: number, a: number, b: number) => clamp01((x - a) / (b - a))
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

// Replace an element's text by editing its text node (a characterData change, so it doesn't wake
// the reveal MutationObserver, which watches childList).
export function setText(el: Element | null | undefined, text: string) {
  if (!el) return
  const n = el.firstChild
  if (n && n.nodeType === Node.TEXT_NODE && !n.nextSibling) {
    if ((n as Text).data !== text) (n as Text).data = text
  } else el.textContent = text
}
