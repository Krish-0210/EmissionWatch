// Screenshots of every page at desktop and phone size, after the intro, into docs/reference/screens/
// (gitignored). Needs a running server: `npm run build && npm run preview` (port 4173).
//   node scripts/screens.mjs [baseUrl] [--only=home,map] [--fps]
// Uses the installed Chrome (channel "chrome"); falls back to Playwright's Chromium.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../docs/reference/screens')
mkdirSync(out, { recursive: true })
const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const fps = args.includes('--fps')

const PAGES = [
  { id: 'home', path: '/?intro=0', scrolls: [0, 0.3, 0.55, 0.75, 0.97] },
  { id: 'map', path: '/map', scrolls: [0, 1] },
  { id: 'cluster', path: '/cluster/talcher', scrolls: [0, 1] },
  { id: 'near', path: '/near-me', scrolls: [0, 1] },
  { id: 'how', path: '/how-it-works', scrolls: [0, 0.35, 1] },
  { id: 'limits', path: '/limits', scrolls: [0, 1] },
]
const SIZES = [
  { id: 'd', width: 1440, height: 900, mobile: false },
  { id: 'm', width: 375, height: 812, mobile: true },
]

const launch = async () => {
  const opts = { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'], headless: true }
  try {
    return await chromium.launch({ ...opts, channel: 'chrome' })
  } catch {
    return chromium.launch(opts)
  }
}
const browser = await launch()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`))
  for (const p of PAGES) {
    if (only && !only.includes(p.id)) continue
    await page.goto(base + p.path, { waitUntil: 'networkidle' })
    await page.mouse.move(size.width * 0.3, size.height * 0.5)
    await sleep(2500)
    for (const [i, s] of p.scrolls.entries()) {
      await page.evaluate((k) => window.scrollTo(0, k * (document.documentElement.scrollHeight - innerHeight)), s)
      await sleep(1400)
      const file = `${out}/${p.id}-${size.id}-${i}.png`
      await page.screenshot({ path: file })
      console.log(file)
    }
  }
  if (fps && !size.mobile) {
    // Intro + idle hero frame rate on Home (rAF intervals).
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    const measure = (ms) =>
      page.evaluate(
        (ms) =>
          new Promise((done) => {
            const t = []
            const f = (now) => {
              t.push(now)
              if (now - t[0] < ms) requestAnimationFrame(f)
              else {
                const d = t.slice(1).map((x, i) => x - t[i])
                d.sort((a, b) => a - b)
                done({ fps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), p95ms: +d[Math.floor(d.length * 0.95)].toFixed(1), maxms: +d[d.length - 1].toFixed(1) })
              }
            }
            requestAnimationFrame(f)
          }),
        ms,
      )
    console.log('intro', await measure(4200))
    await sleep(800)
    console.log('hero idle', await measure(3000))
    await page.evaluate(() => window.scrollTo(0, innerHeight * 1.5))
    console.log('story', await measure(3000))
    await page.goto(base + '/', { waitUntil: 'commit' })
    const t0 = Date.now()
    for (const t of [400, 900, 1400, 1900, 2400, 2900, 3400, 4200]) {
      await sleep(Math.max(0, t - (Date.now() - t0)))
      await page.screenshot({ path: `${out}/intro-${t}.png` })
    }
  }
  await ctx.close()
}
await browser.close()
