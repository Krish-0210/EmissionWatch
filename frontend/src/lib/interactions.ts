// Pointer-driven card and button effects, delegated from one listener on the document:
//  - .card / .glass: border spotlight. Cards inside a .spot-group all light up relative to the pointer.
//  - .tilt: 3D tilt toward the pointer (CSS vars --rx / --ry).
//  - .magnetic: buttons lean toward the pointer (--tx / --ty).
//  - .pill, .ripple: press ripple at the pointer position.
// No React state; rects are read once per frame, then CSS variables are written.
import { useEffect } from 'react'
import { prefersReducedMotion } from './motion'
import { scramble } from './scramble'
import { sound } from './sound'

const CARD = '.card, .glass'
// Things that tick on hover and chirp on press.
const SOUNDED = 'a[href], button, [role="button"], [role="tab"], .fchip, select, summary, input[type="range"], .leaflet-interactive'
const soundKind = (el: Element) =>
  el.matches('.card, .card *') ? 'card' : el.matches('.fchip, .chip, [role="tab"]') ? 'chip' : el.matches('button, .pill, [role="button"]') ? 'button' : 'link'

export function useInteractions() {
  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduced = prefersReducedMotion()
    let x = 0, y = 0, target: Element | null = null, raf = 0, rehit = false
    let lit: HTMLElement[] = []
    let tilted: HTMLElement | null = null
    let magnet: HTMLElement | null = null

    const frame = () => {
      raf = 0
      if (rehit) {
        rehit = false
        target = document.elementFromPoint(x, y)
      }
      const t = target
      // Spotlight: the hovered card, or every card of the hovered group.
      const group = t?.closest<HTMLElement>('.spot-group')
      const card = t?.closest<HTMLElement>(CARD)
      const next = group ? Array.from(group.querySelectorAll<HTMLElement>(CARD)) : card ? [card] : []
      const rects = next.map((el) => el.getBoundingClientRect())
      lit.forEach((el) => {
        if (!next.includes(el)) el.classList.remove('lit')
      })
      next.forEach((el, i) => {
        el.style.setProperty('--mx', `${(x - rects[i].left).toFixed(0)}px`)
        el.style.setProperty('--my', `${(y - rects[i].top).toFixed(0)}px`)
        el.classList.add('lit')
      })
      lit = next

      if (reduced) return
      // Tilt
      const tc = t?.closest<HTMLElement>('.tilt') ?? null
      if (tilted && tilted !== tc) {
        tilted.style.setProperty('--rx', '0deg')
        tilted.style.setProperty('--ry', '0deg')
        tilted.classList.remove('tilting')
      }
      if (tc) {
        const r = tc === card ? rects[next.indexOf(tc)] ?? tc.getBoundingClientRect() : tc.getBoundingClientRect()
        const px = (x - r.left) / r.width - 0.5, py = (y - r.top) / r.height - 0.5
        const k = Number(tc.dataset.tilt) || 6
        tc.style.setProperty('--rx', `${(-py * k).toFixed(2)}deg`)
        tc.style.setProperty('--ry', `${(px * k).toFixed(2)}deg`)
        tc.classList.add('tilting')
      }
      tilted = tc
      // Magnetic buttons
      const mb = t?.closest<HTMLElement>('.magnetic, .pill') ?? null
      if (magnet && magnet !== mb) {
        magnet.style.setProperty('--tx', '0px')
        magnet.style.setProperty('--ty', '0px')
      }
      if (mb) {
        const r = mb.getBoundingClientRect()
        mb.style.setProperty('--tx', `${((x - r.left - r.width / 2) * 0.22).toFixed(1)}px`)
        mb.style.setProperty('--ty', `${((y - r.top - r.height / 2) * 0.3).toFixed(1)}px`)
      }
      magnet = mb
    }
    const move = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      target = e.target as Element | null
      if (!raf) raf = requestAnimationFrame(frame)
    }
    const leave = () => {
      target = null
      if (!raf) raf = requestAnimationFrame(frame)
    }
    let sounded: Element | null = null
    let filled: HTMLElement | null = null
    // Pill fill grows from where the pointer came in and shrinks toward where it left.
    const fillAt = (el: HTMLElement, cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--fx', `${(cx - r.left).toFixed(0)}px`)
      el.style.setProperty('--fy', `${(cy - r.top).toFixed(0)}px`)
      el.style.setProperty('--fd', `${(Math.hypot(r.width, r.height) * 2.1).toFixed(0)}px`)
    }
    const over = (e: PointerEvent) => {
      const pill = (e.target as Element | null)?.closest?.<HTMLElement>('.pill') ?? null
      if (pill !== filled) {
        if (filled) fillAt(filled, e.clientX, e.clientY)
        if (pill) fillAt(pill, e.clientX, e.clientY)
        filled = pill
      }
      const el = (e.target as Element | null)?.closest?.(SOUNDED) ?? null
      if (el && el !== sounded && e.pointerType === 'mouse') {
        sound.hover(soundKind(el))
        // Mono buttons decode their label on hover.
        const sc = el.closest('.pill, .ulink, [data-scramble-hover]')
        if (sc && !reduced) scramble(sc, 420)
      }
      sounded = el
    }
    const down = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(SOUNDED)) sound.click()
      const el = (e.target as Element | null)?.closest<HTMLElement>('.pill, .ripple')
      if (!el || reduced) return
      const r = el.getBoundingClientRect()
      const s = document.createElement('span')
      const d = Math.max(r.width, r.height) * 2.2
      s.className = 'ripple-ink'
      s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`
      el.appendChild(s)
      s.addEventListener('animationend', () => s.remove(), { once: true })
    }
    // Scrolling moves cards under a still pointer: refresh the spotlight.
    const scroll = () => {
      if (!target) return
      rehit = true
      if (!raf) raf = requestAnimationFrame(frame)
    }
    if (fine) {
      window.addEventListener('pointermove', move, { passive: true })
      document.documentElement.addEventListener('pointerleave', leave)
      window.addEventListener('scroll', scroll, { passive: true })
    }
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointerover', over, { passive: true })
    return () => {
      window.removeEventListener('pointerover', over)
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      window.removeEventListener('scroll', scroll)
      window.removeEventListener('pointerdown', down)
    }
  }, [])
}
