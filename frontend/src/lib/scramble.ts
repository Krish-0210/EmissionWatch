// Decoding text: characters cycle through telemetry glyphs and lock in left to right, like a
// readout acquiring a signal. Works on the element's own text nodes (layout-stable: monospace
// labels keep their width; spaces and punctuation are left alone).
const GLYPHS = '01<>/\\|=+*#%&_-:ABCDEFGHJKLMNPRSTUVWXYZ'
const running = new WeakMap<Element, number>()

function textNodes(el: Element): Text[] {
  const out: Text[] = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.arrow, .sr-only, svg, .no-scramble') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  while (w.nextNode()) {
    const t = w.currentNode as Text
    if (t.data.trim()) out.push(t)
  }
  return out
}

/** Scramble an element's text into place over `duration` ms. Re-entrant calls are ignored. */
export function scramble(el: Element, duration = 650) {
  if (running.has(el) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const nodes = textNodes(el)
  if (!nodes.length || nodes.length > 6) return
  const finals = nodes.map((n) => n.data)
  const total = finals.reduce((a, s) => a + s.length, 0)
  if (total > 80) return
  const t0 = performance.now()
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / duration)
    let idx = 0
    nodes.forEach((n, ni) => {
      const f = finals[ni]
      let s = ''
      for (let i = 0; i < f.length; i++, idx++) {
        const c = f[i]
        const lock = idx / total < k * 1.15 - 0.1
        s += lock || /[\s.,·:;()'’/-]/.test(c) ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      if (n.data !== s) n.data = s
    })
    if (k < 1) running.set(el, requestAnimationFrame(step))
    else {
      nodes.forEach((n, ni) => (n.data = finals[ni]))
      running.delete(el)
    }
  }
  running.set(el, requestAnimationFrame(step))
}
