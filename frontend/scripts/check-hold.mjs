// Click-and-hold check: hint, hold build-up and release frames + frame-time stats during the hold,
// on Home and one inner page. Screens go to docs/reference/screens/hold-*.png (gitignored).
//   node scripts/check-hold.mjs [baseUrl] [--page=/map]
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../docs/reference/screens')
mkdirSync(out, { recursive: true })
const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const extra = args.find((a) => a.startsWith('--page='))?.slice(7)
const pages = [['home', '/?intro=0'], ...(extra ? [[extra.replace(/\W/g, '') || 'page', extra.startsWith('/') ? extra : '/' + extra]] : [['map', '/map']])]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] }).catch(() => chromium.launch({ headless: true }))
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

for (const [id, path] of pages) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.removeItem('pc-hold-seen'))
  await sleep(2500)
  const zone = await page.locator('[data-hold]').first().boundingBox()
  const x = Math.round(zone.x + zone.width * (id === 'home' ? 0.66 : 0.75)), y = Math.round(zone.y + Math.min(zone.height, 900 - zone.y) * 0.5)
  await page.mouse.move(x - 40, y - 30)
  await page.mouse.move(x, y, { steps: 6 })
  await sleep(700)
  await page.screenshot({ path: `${out}/hold-${id}-0-hint.png` })
  await page.evaluate(() => {
    window.__ft = []
    let last = performance.now()
    const f = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length < 2000) requestAnimationFrame(f) }
    requestAnimationFrame(f)
  })
  await page.mouse.down()
  const t0 = Date.now()
  for (const at of [500, 1200, 2000, 3000, 3700]) {
    await sleep(Math.max(0, at - (Date.now() - t0)))
    await page.screenshot({ path: `${out}/hold-${id}-1-hold-${at}.png` })
  }
  await page.mouse.up()
  const t1 = Date.now()
  for (const at of [60, 200, 420, 800, 1500]) {
    await sleep(Math.max(0, at - (Date.now() - t1)))
    await page.screenshot({ path: `${out}/hold-${id}-2-rel-${at}.png` })
  }
  // frame stats over a clean run (no screenshots): hold 3.8 s + release
  await sleep(800)
  await page.evaluate(() => (window.__ft = []))
  await page.evaluate(() => {
    window.__ft = []
    let last = performance.now()
    const f = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length < 2000) requestAnimationFrame(f) }
    requestAnimationFrame(f)
  })
  await page.mouse.down()
  await sleep(3800)
  await page.mouse.up()
  await sleep(1400)
  const ft = await page.evaluate(() => window.__ft.slice(1))
  ft.sort((a, b) => a - b)
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length
  console.log(`${id}: hold+release ${ft.length} frames, avg ${(1000 / avg).toFixed(0)} fps, p95 ${ft[Math.floor(ft.length * 0.95)].toFixed(1)} ms, max ${ft[ft.length - 1].toFixed(1)} ms, >33ms: ${ft.filter((v) => v > 33.4).length}`)
  const seen = await page.evaluate(() => localStorage.getItem('pc-hold-seen'))
  console.log(`${id}: hint dismissed after full scan: ${seen === '1'}`)
}
console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'no console errors')
await browser.close()
