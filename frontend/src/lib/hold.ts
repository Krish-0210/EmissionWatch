// Click-and-hold "scan deeper" state, shared by the effect layer (components/HoldFX), the cursor
// (progress ring + hint) and the 3D globe (plumes flare, camera dives). Plain mutable object, read
// every frame; no React state.
export const HOLD_FULL = 3.6 // seconds to full charge (lib/sound uses the same figure)
export const BLAST_MS = 1300 // release animation length

// Pressing on these never starts a hold.
export const HOLD_EXCLUDE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="slider"], [contenteditable], .leaflet-container, .recharts-wrapper, .globe-tip, .orbit-chip, [data-nohold]'

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
}
