// Where the hero globe sits on screen. Shared by GlobeScene (3D) and the intro (DOM), so the
// intro's dotted globe lands exactly on the 3D globe. No three.js import: the intro loads before the 3D chunk.
export const FOV = 40
export const heroDist = (narrow: boolean) => (narrow ? 6.2 : 4.3)
export const heroOffset = (narrow: boolean) => (narrow ? { x: 0, y: -0.8 } : { x: 1.45, y: 0 })

/** Globe centre and silhouette radius in CSS px for a viewport of w x h. */
export function heroGlobeScreen(w: number, h: number) {
  const narrow = w < 768
  const d = heroDist(narrow)
  const o = heroOffset(narrow)
  const t = Math.tan(((FOV / 2) * Math.PI) / 180)
  const aspect = w / h
  const cx = (w / 2) * (1 + o.x / (d * t * aspect))
  const cy = (h / 2) * (1 - o.y / (d * t))
  const dist = Math.hypot(d, o.x, o.y)
  const r = (Math.tan(Math.asin(1 / dist)) / t) * (h / 2)
  return { cx, cy, r }
}
