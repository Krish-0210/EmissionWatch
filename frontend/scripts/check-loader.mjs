// Loader / intro frames: screenshots every 150 ms for the first 4.2 s of a fresh load of Home, into
// docs/reference/screens/loader-*.png (gitignored). node scripts/check-loader.mjs [baseUrl]
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../docs/reference/screens')
mkdirSync(out, { recursive: true })
const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] }).catch(() => chromium.launch({ headless: true }))
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(base + '/', { waitUntil: 'commit' })
await page.waitForSelector('.intro', { timeout: 15000 })
const t0 = Date.now()
for (let at = 0; at <= 4200; at += 150) {
  const w = at - (Date.now() - t0)
  if (w > 0) await new Promise((r) => setTimeout(r, w))
  await page.screenshot({ path: `${out}/loader-${String(at).padStart(4, '0')}.png` })
}
console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'no console errors')
await browser.close()
