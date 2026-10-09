// Page transition check: click a nav link on Home, screenshot every ~90 ms through cover, card and
// reveal, then Back (reveal only). Screens: docs/reference/screens/ptx-*.png (gitignored).
//   node scripts/check-transition.mjs [baseUrl]
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../docs/reference/screens')
mkdirSync(out, { recursive: true })
const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }))
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(base + '/?intro=0', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
const shoot = async (tag, ms) => {
  const t0 = Date.now()
  let i = 0
  while (Date.now() - t0 < ms) await page.screenshot({ path: `${out}/ptx-${tag}-${String(i++).padStart(2, '0')}.png` })
  return i
}
await page.locator('.nav-links a', { hasText: 'Limits' }).first().click()
const n1 = await shoot('fwd', 1700)
console.log('url after click:', page.url(), 'frames', n1)
await page.waitForTimeout(800)
await page.goBack()
const n2 = await shoot('back', 1100)
console.log('url after back:', page.url(), 'frames', n2)
console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'no console errors')
await browser.close()
