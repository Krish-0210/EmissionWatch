// Lists frames over 34 ms during the first 6 s of Home (intro + hero). Needs preview on 4173.
//   node scripts/long-frames.mjs [path] [--headed]
import { chromium } from 'playwright'
const path = process.argv[2]?.startsWith('-') ? '' : (process.argv[2] ?? '')
const b = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.addInitScript(() => {
  const t0 = performance.now()
  const out = []
  let last = t0
  const f = (now) => {
    if (now - last > 34) out.push([Math.round(last - t0), Math.round(now - last)])
    last = now
    if (now - t0 < 6000) requestAnimationFrame(f)
    else window.__long = out
  }
  requestAnimationFrame(f)
})
await p.goto((process.env.BASE ?? 'http://localhost:4173') + '/' + path, { waitUntil: 'commit' })
await p.waitForFunction(() => window.__long, null, { timeout: 15000 })
console.log(JSON.stringify(await p.evaluate(() => window.__long)))
console.log('renderer', await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?' }))
await b.close()
