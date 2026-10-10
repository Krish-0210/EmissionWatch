// Click-and-hold "scan deeper" state, shared by the effect layer (components/HoldFX), the cursor
// (progress ring + hint) and the 3D globe (plumes flare, camera dives). Plain mutable object, read
// every frame; no React state.
export const HOLD_FULL = 3.6 // seconds to full charge (lib/sound uses the same figure)
export const BLAST_MS = 1300 // release animation length

// Pressing on these never starts a hold.
export const HOLD_EXCLUDE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="slider"], [contenteditable], .leaflet-container, .recharts-wrapper, .globe-tip, .orbit-chip, [data-nohold]'

/** Text under the pointer: the element itself holds non-blank text that can be selected. */
function onText(el: Element) {
  for (const n of el.childNodes)
    if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) return getComputedStyle(el).userSelect !== 'none'
  return false
}

/** The [data-hold] zone a press on `t` would charge, or null (outside a zone, or on a control, the map
 *  or text). The one eligibility test: HoldFX starts holds with it and the cursor's "hold to scan"
 *  hint shows with it, so the two never disagree. */
export function holdZoneFor(t: EventTarget | null): HTMLElement | null {
  if (!(t instanceof Element)) return null
  const zone = t.closest<HTMLElement>('[data-hold]')
  if (!zone || t.closest(HOLD_EXCLUDE) || onText(t)) return null
  return zone
}

export const holdState = {
  /** 0..1 charge while holding (eased); falls back to 0 after release. */
  level: 0,
  holding: false,
  x: 0,
  y: 0,
  /** performance.now() of the last release (blast), 0 if none. */
  blastAt: 0,
  blastLevel: 0,
  /** pointer is over a hold zone (for the cursor hint) */
  zone: false,
}

/** True while a hold or its release animation is running (keeps the globe rendering). */
export function holdBusy(now = performance.now()) {
  return holdState.holding || now - holdState.blastAt < BLAST_MS
}

const SEEN = 'pc-hold-seen'
export function holdSeen(): boolean {
  try {
    return localStorage.getItem(SEEN) === '1'
  } catch {
    return false
  }
}
export function markHoldSeen() {
  try {
    localStorage.setItem(SEEN, '1')
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(SEEN)) // HoldFX's tip hides
}
export const HOLD_SEEN_EVENT = SEEN
