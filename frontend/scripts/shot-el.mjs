// Screenshot one element: node scripts/shot-el.mjs <path without leading slash> <selector> <out.png> [width]
import { chromium } from 'playwright'
const [path, sel, out, w = '1440'] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: +w, height: 900 } })
p.on('pageerror', (e) => console.log('[pageerror]', e.message))
await p.goto('http://localhost:4173/' + path, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const el = p.locator(sel).first()
await el.scrollIntoViewIfNeeded()
await p.waitForTimeout(2500)
await el.screenshot({ path: out })
await b.close()
