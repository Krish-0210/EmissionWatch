// Dev-only FPS / frame-time readout (imported from main.tsx behind import.meta.env.DEV, so it is
// dropped from the production build). Shows FPS, mean and p95 frame time over the last second,
// and the worst FPS of the last 10 s. The latest sample is also in data-fps on the element.
const el = document.createElement('div')
el.setAttribute('aria-hidden', 'true')
el.style.cssText =
  'position:fixed;right:8px;bottom:8px;z-index:9999;pointer-events:none;padding:6px 9px;border-radius:6px;' +
  'background:rgba(0,0,0,.75);color:#7ce8d8;font:11px/1.35 ui-monospace,monospace;white-space:pre'
document.body.appendChild(el)

let last = performance.now()
let windowStart = last
let dts: number[] = []
const history: number[] = []

function frame(now: number) {
  dts.push(now - last)
  last = now
  if (now - windowStart >= 1000) {
    const fps = (dts.length * 1000) / (now - windowStart)
    const sorted = [...dts].sort((a, b) => a - b)
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    history.push(fps)
    if (history.length > 10) history.shift()
    el.textContent = `${fps.toFixed(0)} fps  min10s ${Math.min(...history).toFixed(0)}\n${mean.toFixed(1)} ms avg  ${p95.toFixed(1)} p95`
    el.dataset.fps = fps.toFixed(1)
    el.style.color = fps >= 55 ? '#7ce8d8' : fps >= 40 ? '#ffc24b' : '#ff5a3c'
    dts = []
    windowStart = now
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

export {}
