import { useEffect, useRef } from 'react'
import { gsap } from '../lib/gsap'
import { HOLD_EXCLUDE, holdSeen, holdState } from '../lib/hold'
import { useMediaQuery, useReducedMotion } from '../lib/motion'

// Ring that trails the pointer (the native cursor stays), with states:
//   link    ring grows                     button  ring grows and fills (teal)
//   view    big ring + label (cards, images; [data-cursor="view"|"open"], [data-cursor-label])
//   drag    ring with arrows + DRAG (map, globe; [data-cursor="drag"])
//   text    hidden over inputs
//   hold    over a [data-hold] zone: a small HOLD TO SCAN hint (until the first full scan), and while
//           holding a progress ring that fills with the charge; the ring pulses on release.
// Fine pointer + desktop width only, off for reduced motion. No React state: pointer events store
// the target, GSAP's ticker lerps and writes transforms.
const LINK = 'a[href]'
const BUTTON = 'button, [role="button"], [role="tab"], .pill, .fchip, select, summary'
const VIEW = '[data-cursor="view"], [data-cursor="open"], .card.tilt, a.card, .phero-visual, .il'
const DRAG = '[data-cursor="drag"], .leaflet-container, .stage-visual canvas'
const TEXT = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable]'
const CIRC = 2 * Math.PI * 30

type State = 'default' | 'link' | 'button' | 'view' | 'drag' | 'text'

function stateFor(t: Element | null): { s: State; label: string; zone: boolean } {
  if (!t?.closest) return { s: 'default', label: '', zone: false }
  const zone = !!t.closest('[data-hold]') && !t.closest(HOLD_EXCLUDE)
  if (t.closest(TEXT)) return { s: 'text', label: '', zone: false }
  const labelled = t.closest<HTMLElement>('[data-cursor-label]')
  const drag = t.closest(DRAG)
  if (drag && !t.closest('.leaflet-control, .leaflet-popup, ' + BUTTON)) return { s: 'drag', label: 'Drag', zone }
  if (t.closest(BUTTON)) return { s: 'button', label: '', zone: false }
  if (t.closest('.recharts-wrapper, .chart-card')) return { s: 'default', label: '', zone }
  const view = t.closest<HTMLElement>(VIEW)
  if (view) {
    const link = t.closest(LINK)
    return { s: 'view', label: labelled?.dataset.cursorLabel ?? (link ? 'Open' : view.dataset.cursor === 'open' ? 'Open' : ''), zone }
  }
  if (t.closest(LINK)) return { s: 'link', label: '', zone: false }
  return { s: 'default', label: '', zone }
}

export default function Cursor() {
  const fine = useMediaQuery('(pointer: fine) and (min-width: 768px)')
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!fine || reduced || !el) return
    const ring = el.querySelector<HTMLElement>('.c-ring')!
    const label = el.querySelector<HTMLElement>('.c-label')!
    const hint = el.querySelector<HTMLElement>('.c-hint')!
    const prog = el.querySelector<SVGCircleElement>('.c-prog circle')!
    let x = -100, y = -100, cx = -100, cy = -100, moving = false
    let lastTarget: EventTarget | null = null
    let state: State = 'default'
    let showHint = !holdSeen()
    let lastLevel = -1
    let wasHolding = false
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      x = e.clientX
      y = e.clientY
      if (!moving) {
        moving = true
        el.classList.add('on')
      }
      if (e.target !== lastTarget) {
        lastTarget = e.target
        const st = stateFor(e.target as Element)
        holdState.zone = st.zone
        if (st.s !== state) {
          el.dataset.state = st.s
          state = st.s
        }
        if (label.textContent !== st.label) label.textContent = st.label
        el.classList.toggle('zone', st.zone && showHint)
      }
    }
    const leave = () => {
      moving = false
      el.classList.remove('on')
    }
    const tick = (_t: number, dtMs: number) => {
      // Hold progress ring + hint
      const lv = holdState.level
      if (holdState.holding !== wasHolding) {
        wasHolding = holdState.holding
        el.classList.toggle('holding', wasHolding)
        if (!wasHolding) {
          el.classList.remove('pulse')
          void el.offsetWidth
          el.classList.add('pulse')
          if (holdState.blastLevel > 0.5) {
            showHint = false
            el.classList.remove('zone')
          }
        }
      }
      if (Math.abs(lv - lastLevel) > 0.002) {
        lastLevel = lv
        prog.style.strokeDashoffset = (CIRC * (1 - lv)).toFixed(1)
      }
      const dx = x - cx, dy = y - cy
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return
      // Lerp 0.2 per 60 Hz frame, frame-rate independent.
      const k = 1 - Math.pow(1 - 0.2, Math.min(dtMs, 50) / 16.67)
      cx += dx * k
      cy += dy * k
      const t = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`
      ring.style.transform = t
      hint.style.transform = `translate3d(${(cx + 24).toFixed(1)}px, ${(cy + 20).toFixed(1)}px, 0)`
    }
    gsap.ticker.add(tick)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      gsap.ticker.remove(tick)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', move)
      document.removeEventListener('pointerleave', leave)
    }
  }, [fine, reduced])

  if (!fine || reduced) return null
  return (
    <div ref={ref} className="cursor" data-state="default" aria-hidden="true">
      <div className="c-ring">
        <i className="c-circle" />
        <svg className="c-prog" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="30" style={{ strokeDasharray: CIRC, strokeDashoffset: CIRC }} />
        </svg>
        <span className="c-arrows">
          <b>‹</b>
          <b>›</b>
        </span>
        <span className="c-label" />
      </div>
      <span className="c-hint">Hold to scan</span>
    </div>
  )
}
