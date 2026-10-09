// Mean FPS / p95 frame time over 3 s on a page after it settles. Needs preview on 4173.
//   node scripts/fps.mjs <path without leading slash> [waitMs]
import { chromium } from 'playwright'
const [path = '', wait = '5000'] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto('http://localhost:4173/' + path, { waitUntil: 'networkidle' })
await p.mouse.move(400, 400)
await p.waitForTimeout(+wait)
const r = await p.evaluate(() => new Promise((done) => {
  const t = []
  const f = (now) => { t.push(now); if (now - t[0] < 3000) requestAnimationFrame(f); else { const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b); done({ fps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) }) } }
  requestAnimationFrame(f)
}))
console.log(path || '/', JSON.stringify(r))
await b.close()
