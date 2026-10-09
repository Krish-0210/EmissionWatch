// Touch: tap a plume on the Home globe shows its tooltip; a second tap opens the cluster. Needs preview on 4173.
import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
const p = await ctx.newPage()
await p.goto('http://localhost:4173/?intro=0', { waitUntil: 'networkidle' })
await p.touchscreen.tap(380, 840) // intent -> 3D mounts
await p.waitForTimeout(4000)
// Scan the lower half of the screen for a tap that opens a tooltip (plumes are near India).
let hit = null
outer: for (let y = 520; y < 800; y += 16)
  for (let x = 20; x < 380; x += 16) {
    if (await p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return !el?.closest('.globe-host') }, [x, y])) continue
    await p.touchscreen.tap(x, y)
    await p.waitForTimeout(120)
    const t = await p.evaluate(() => document.querySelector('.globe-tip.on')?.textContent)
    if (t) { hit = { x, y, t }; break outer }
  }
console.log('first tap:', JSON.stringify(hit))
if (hit) {
  await p.screenshot({ path: process.argv[2] })
  await p.touchscreen.tap(hit.x, hit.y)
  await p.waitForTimeout(1500)
  console.log('second tap ->', p.url())
}
await b.close()
