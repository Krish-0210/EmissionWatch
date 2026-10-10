// Composited layers per page (CDP LayerTree): count, painted area as multiples of the viewport, and
// the biggest layers with their compositing reasons. Needs a preview server (default 4173).
//   node scripts/layers.mjs [baseUrl] [path ...] [--at=0,0.3,0.6]   (paths without leading slash)
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const at = (args.find((a) => a.startsWith('--at='))?.slice(5) ?? '0,0.35,0.7').split(',').map(Number)
const paths = args.filter((a) => !a.startsWith('http') && !a.startsWith('--'))
const list = paths.length ? paths : ['?intro=0', 'map', 'cluster/talcher', 'near-me', 'how-it-works', 'limits']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
const W = 1440, H = 900
for (const path of list) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } })
  const p = await ctx.newPage()
  await p.addInitScript(() => localStorage.setItem('pc-hold-seen', '1'))
  await p.goto(`${base}/${path}`, { waitUntil: 'networkidle' })
  await sleep(2500)
  const cdp = await ctx.newCDPSession(p)
  await cdp.send('DOM.enable')
  await cdp.send('LayerTree.enable')
  let layers = []
  cdp.on('LayerTree.layerTreeDidChange', (e) => e.layers && (layers = e.layers))
  for (const f of at) {
    await p.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), f)
    await sleep(1200)
    await p.mouse.move(700, 450)
    await sleep(300)
    const drawn = layers.filter((l) => l.drawsContent && !l.invisible)
    const area = drawn.reduce((s, l) => s + l.width * l.height, 0)
    const big = [...drawn].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 10)
    console.log(`\n== /${path} @${f}: ${layers.length} layers, ${drawn.length} drawing, painted area ${(area / (W * H)).toFixed(1)} viewports`)
    // histogram: element (tag.class) and first compositing reason, by count and area
    const hist = new Map()
    for (const l of drawn) {
      let who = l.backendNodeId ? '?' : '(anon)'
      if (l.backendNodeId)
        try {
          const { node } = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId })
          const cls = (node.attributes ?? []).reduce((s, v, i, a) => (a[i - 1] === 'class' ? v : s), '')
          who = `${node.localName || node.nodeName}${cls ? '.' + cls.split(' ')[0] : ''}`
        } catch {}
      let r = ''
      try {
        r = ((await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId })).compositingReasonIds ?? [])[0] ?? ''
      } catch {}
      const k = `${who} ${r}`
      const h = hist.get(k) ?? { n: 0, a: 0 }
      h.n++
      h.a += l.width * l.height
      hist.set(k, h)
    }
    console.log('   by element: ' + [...hist].sort((a, b) => b[1].n - a[1].n).slice(0, 14).map(([k, h]) => `${k} ×${h.n} (${(h.a / (W * H)).toFixed(1)}vp)`).join(' · '))
    for (const l of big) {
      let reasons = []
      try {
        reasons = (await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId })).compositingReasonIds ?? []
      } catch {}
      let who = ''
      if (l.backendNodeId) {
        try {
          const { node } = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId })
          const cls = (node.attributes ?? []).reduce((s, v, i, a) => (a[i - 1] === 'class' ? v : s), '')
          who = `${node.localName || node.nodeName}${cls ? '.' + cls.split(' ').slice(0, 3).join('.') : ''}`
        } catch {}
      }
      console.log(`   ${String(Math.round(l.width)).padStart(5)}x${String(Math.round(l.height)).padEnd(5)} ${who.padEnd(42)} ${reasons.slice(0, 3).join(',')}`)
    }
  }
  await ctx.close()
}
await browser.close()
