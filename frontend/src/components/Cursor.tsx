import { useEffect, useRef } from 'react'
import { gsap } from '../lib/gsap'
import { holdState, holdZoneFor } from '../lib/hold'
import { useMediaQuery, useReducedMotion } from '../lib/motion'

// Ring that trails the pointer (the native cursor stays), with states:
//   link    ring grows                     button  ring grows and fills (teal)
//   view    big ring + label (cards, images; [data-cursor="view"|"open"], [data-cursor-label])
//   drag    ring with arrows + DRAG (map, globe; [data-cursor="drag"])
//   text    hidden over inputs
//   hint    over a spot where a press would start a hold (lib/hold holdZoneFor, the same test HoldFX
//           uses): a thin ring + "HOLD TO SCAN" below the cursor. Hidden at once outside a zone,
//           while the page scrolls (re-checked once scrolling stops) and for 1 s after a release.
//   hold    while holding the ring fills with the charge (teal, turning ember near full); the ring
//           pulses on release (the one-time "hold to scan" tip is HoldFX's HoldTip).
// Fine pointer + desktop width only, off for reduced motion (as is the hold). No React state: pointer
// events store the target, GSAP's ticker lerps and writes transforms. No layout reads per frame.
const LINK = 'a[href]'
const BUTTON = 'button, [role="button"], [role="tab"], .pill, .fchip, select, summary'
const VIEW = '[data-cursor="view"], [data-cursor="open"], .card.tilt, a.card, .phero-visual, .il'
const DRAG = '[data-cursor="drag"], .leaflet-container, .stage-visual canvas'
const TEXT = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable]'
const CIRC = 2 * Math.PI * 30
const HINT_AFTER_BLAST_MS = 1000
const SCROLL_SETTLE_MS = 140
const TEAL = [124, 232, 216], EMBER = [255, 138, 61]

type State = 'default' | 'link' | 'button' | 'view' | 'drag' | 'text'

function stateFor(t: Element | null): { s: State; label: string } {
  if (!t?.closest) return { s: 'default', label: '' }
  if (t.closest(TEXT)) return { s: 'text', label: '' }
  const labelled = t.closest<HTMLElement>('[data-cursor-label]')
  const drag = t.closest(DRAG)
  if (drag && !t.closest('.leaflet-control, .leaflet-popup, ' + BUTTON)) return { s: 'drag', label: 'Drag' }
  if (t.closest(BUTTON)) return { s: 'button', label: '' }
  if (t.closest('.recharts-wrapper, .chart-card')) return { s: 'default', label: '' }
  const view = t.closest<HTMLElement>(VIEW)
  if (view) {
    const link = t.closest(LINK)
    return { s: 'view', label: labelled?.dataset.cursorLabel ?? (link ? 'Open' : view.dataset.cursor === 'open' ? 'Open' : '') }
  }
  if (t.closest(LINK)) return { s: 'link', label: '' }
  return { s: 'default', label: '' }
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
    const prog = el.querySelector<SVGSVGElement>('.c-prog')!
    const bar = el.querySelector<SVGCircleElement>('.c-prog .c-bar')!
    let x = -100, y = -100, cx = -100, cy = -100, moving = false
    let lastTarget: EventTarget | null = null
    let state: State = 'default'
    let lastLevel = -1
    let wasHolding = false
    // Hint: the zone under the pointer (from the target), scrolling, and the post-release pause.
    let zone: HTMLElement | null = null
    let scrolling = false
    let scrollTimer = 0
    let hintAfter = 0
    let hintTimer = 0
    let hintOn = false
    const updateHint = () => {
      const on = moving && !!zone && zone.isConnected && !scrolling && performance.now() >= hintAfter
      if (on !== hintOn) {
        hintOn = on
        el.classList.toggle('hint', on)
      }
    }
    const setTarget = (t: EventTarget | null) => {
      lastTarget = t
      const st = stateFor(t as Element)
      zone = holdZoneFor(t)
      holdState.zone = !!zone
      if (st.s !== state) {
        el.dataset.state = st.s
        state = st.s
      }
      if (label.textContent !== st.label) label.textContent = st.label
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      x = e.clientX
      y = e.clientY
      if (!moving) {
        moving = true
        el.classList.add('on')
      }
      if (e.target !== lastTarget) setTarget(e.target)
      updateHint()
    }
    const leave = () => {
      moving = false
      el.classList.remove('on')
      updateHint()
    }
    // Scrolling moves the page under a still pointer: hide the hint at once, then hit-test once when
    // scrolling stops (one elementFromPoint per scroll gesture, none per frame).
    const scroll = () => {
      if (!moving) return
      scrolling = true
      updateHint()
      window.clearTimeout(scrollTimer)
      scrollTimer = window.setTimeout(() => {
        scrolling = false
        setTarget(document.elementFromPoint(x, y))
        updateHint()
      }, SCROLL_SETTLE_MS)
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
          // Release: the hint hides and may come back after a pause.
          hintAfter = performance.now() + HINT_AFTER_BLAST_MS
          updateHint()
          window.clearTimeout(hintTimer)
          hintTimer = window.setTimeout(updateHint, HINT_AFTER_BLAST_MS + 20)
        }
      }
      if (Math.abs(lv - lastLevel) > 0.002) {
        lastLevel = lv
        bar.style.strokeDashoffset = (CIRC * (1 - lv)).toFixed(1)
        // teal, turning ember over the last part of the charge
        const k = Math.min(1, Math.max(0, (lv - 0.7) / 0.25))
        prog.style.color = `rgb(${TEAL.map((c, i) => Math.round(c + (EMBER[i] - c) * k)).join(',')})`
      }
      const dx = x - cx, dy = y - cy
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return
      // Lerp 0.2 per 60 Hz frame, frame-rate independent.
      const k = 1 - Math.pow(1 - 0.2, Math.min(dtMs, 50) / 16.67)
      cx += dx * k
      cy += dy * k
      const t = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`
      ring.style.transform = t
    }
    gsap.ticker.add(tick)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', move, { passive: true })
    window.addEventListener('scroll', scroll, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      gsap.ticker.remove(tick)
      window.clearTimeout(scrollTimer)
      window.clearTimeout(hintTimer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', move)
      window.removeEventListener('scroll', scroll)
      document.removeEventListener('pointerleave', leave)
    }
  }, [fine, reduced])

  if (!fine || reduced) return null
  return (
    <div ref={ref} className="cursor" data-state="default" aria-hidden="true">
      <div className="c-ring">
        <i className="c-circle" />
        <svg className="c-prog" viewBox="0 0 64 64">
          <circle className="c-track" cx="32" cy="32" r="30" />
          <circle className="c-bar" cx="32" cy="32" r="30" style={{ strokeDasharray: CIRC, strokeDashoffset: CIRC }} />
        </svg>
        <span className="c-arrows">
          <b>‹</b>
          <b>›</b>
        </span>
        <span className="c-label" />
        <span className="c-hint">Hold to scan</span>
      </div>
    </div>
  )
}
