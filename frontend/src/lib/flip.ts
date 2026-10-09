import { useLayoutEffect, useRef, type RefObject } from 'react'
import { prefersReducedMotion } from './motion'

// FLIP for lists whose items carry data-flip="<key>": call `capture()` right before the state change
// that reorders/filters them; after the render, moved items glide from their old spot and new ones
// fade/scale in. Transform/opacity only (WAAPI).
export function useFlip(container: RefObject<HTMLElement | null>, deps: unknown[]) {
  const before = useRef<Map<string, DOMRect> | null>(null)
  const capture = () => {
    const el = container.current
    if (!el || prefersReducedMotion()) return
    const m = new Map<string, DOMRect>()
    el.querySelectorAll<HTMLElement>('[data-flip]').forEach((n) => m.set(n.dataset.flip!, n.getBoundingClientRect()))
    before.current = m
  }
  useLayoutEffect(() => {
    const prev = before.current
    const el = container.current
    before.current = null
    if (!prev || !el) return
    el.querySelectorAll<HTMLElement>('[data-flip]').forEach((n, i) => {
      const r = n.getBoundingClientRect()
      const old = prev.get(n.dataset.flip!)
      if (old) {
        const dx = old.left - r.left, dy = old.top - r.top
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
          n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
      } else {
        n.animate([{ opacity: 0, transform: 'scale(0.96) translateY(10px)' }, { opacity: 1, transform: 'none' }], {
          duration: 480,
          delay: 60 + i * 30,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'backwards',
        })
      }
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return capture
}
