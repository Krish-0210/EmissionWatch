// Clicks the hero scan button and screenshots the beam + tooltip. Needs preview on 4173.
//   node scripts/check-scan.mjs <out.png>
import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
p.on('pageerror', (e) => console.log('[pageerror]', e.message))
await p.goto('http://localhost:4173/?intro=0', { waitUntil: 'networkidle' })
await p.mouse.move(300, 300)
await p.waitForTimeout(3500)
await p.click('.scan-btn')
await p.waitForTimeout(2000)
console.log('status:', await p.textContent('.hero-orbit [role=status]'))
console.log('tooltip:', await p.evaluate(() => document.querySelector('.globe-tip.on')?.textContent ?? 'none'))
await p.screenshot({ path: process.argv[2] })
await b.close()
