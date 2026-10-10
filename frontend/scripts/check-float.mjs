// Hold-to-float checks (desktop): a click does not start a hold and leaves no inline styles; a hold
// floats the visible elements (nav, headings, cards, globe container); after the release every
// inline translate/rotate/will-change/transition is gone; Escape and leaving the window release; a
// press on a link never arms. Records a short video of hold + release to docs/reference/screens/.
// Needs a preview server (default 4173).
//   node scripts/check-float.mjs [baseUrl] [--page=/how-it-works]
import { mkdirSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../docs/reference/screens')
mkdirSync(out, { recursive: true })
const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const extra = args.find((a) => a.startsWith('--page='))?.slice(7) ?? '/how-it-works'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`)
  if (!ok) failed++
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// Inline styles the float layer may leave behind.
const leftovers = () =>
  page.evaluate(() =>
    // GSAP itself writes translate/rotate 'none' and pins write will-change: transform; only the float layer's values count
    [...document.querySelectorAll('[style]')].filter((el) => (el.style.translate && el.style.translate !== 'none') || (el.style.rotate && el.style.rotate !== 'none') || el.style.willChange.includes('translate') || el.style.transition === 'none').map((el) => el.tagName + '.' + el.className),
  )
const floating = () =>
  page.evaluate(() => [...document.querySelectorAll('[style]')].filter((el) => el.style.translate && el.style.translate !== 'none' && el.style.translate !== '0px 0px').map((el) => (el.className?.baseVal ?? el.className) || el.tagName))

for (const path of ['/?intro=0', extra]) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.mouse.click(700, 3) // unlock audio
  await sleep(600)
  const zone = await page.locator('[data-hold]').first().boundingBox()
  // a non-interactive point in the zone, right of the copy
  const pt = await page.evaluate(({ zx, zy, zw, zh }) => {
    for (let fx = 0.92; fx > 0.4; fx -= 0.04)
      for (let fy = 0.3; fy < 0.9; fy += 0.1) {
        const x = Math.round(zx + zw * fx), y = Math.round(zy + Math.min(zh, innerHeight - zy) * fy)
        const t = document.elementFromPoint(x, y)
        if (t && t.closest('[data-hold]') && !t.closest('a, button, input, select, [role="button"], .leaflet-container')) return { x, y }
      }
    return null
  }, { zx: zone.x, zy: zone.y, zw: zone.width, zh: zone.height })
  if (!pt) {
    check(false, `${path}: no free point in the hold zone`)
    continue
  }
  const { x, y } = pt
  await page.mouse.move(x, y, { steps: 4 })
  await sleep(300)

  // 1. a click (150 ms press) never starts a hold
  await page.mouse.down()
  await sleep(150)
  await page.mouse.up()
  await sleep(500)
  check((await floating()).length === 0 && (await leftovers()).length === 0, `${path}: click does not float anything or leave inline styles`)

  // 2. a 300 ms press is still not a hold
  await page.mouse.down()
  await sleep(300)
  const early = await floating()
  await page.mouse.up()
  await sleep(300)
  check(early.length === 0 && (await leftovers()).length === 0, `${path}: 300 ms press does not start a hold`)

  // 3. hold: elements float, growing with time
  await page.mouse.down()
  await sleep(1200)
  const moved = () => page.evaluate(() => [...document.querySelectorAll('[style]')].filter((el) => el.style.translate && el.style.translate !== 'none').map((el) => el.style.translate))
  const f1 = await moved()
  await sleep(1800)
  const f2 = await moved()
  const mag = (list) => list.reduce((a, s) => a + s.split(' ').reduce((b, v) => b + Math.abs(parseFloat(v)), 0), 0) / Math.max(1, list.length)
  const kinds = await page.evaluate(() => {
    const on = (el) => el.style.translate && el.style.translate !== 'none'
    const has = (sel) => [...document.querySelectorAll(sel)].some(on)
    return { nav: has('.nav .brand, .nav-links > a'), heading: has('h1, h2, h1 *, .phero h1'), globe: has('.globe-host'), count: [...document.querySelectorAll('[style]')].filter(on).length }
  })
  check(f2.length > 10 && kinds.nav && kinds.heading, `${path}: ${kinds.count} elements float (nav ${kinds.nav}, heading ${kinds.heading}${path.startsWith('/?') ? `, globe container ${kinds.globe}` : ''})`)
  check(mag(f2) > mag(f1), `${path}: drift grows with hold time (${mag(f1).toFixed(1)} -> ${mag(f2).toFixed(1)} px avg)`)
  await page.screenshot({ path: `${out}/float-${path.replace(/\W/g, '') || 'home'}-hold.png` })
  await page.mouse.up()
  await sleep(250)
  await page.screenshot({ path: `${out}/float-${path.replace(/\W/g, '') || 'home'}-release.png` })
  await sleep(1400)
  const left = await leftovers()
  check(left.length === 0, `${path}: no inline transforms left after release${left.length ? ': ' + left.slice(0, 5).join(', ') : ''}`)

  // 4. Escape releases
  await page.mouse.down()
  await sleep(1000)
  await page.keyboard.press('Escape')
  await sleep(1500)
  check((await leftovers()).length === 0, `${path}: Escape releases and resets`)
  await page.mouse.up()

  // 5. leaving the window releases
  await page.mouse.move(x, y)
  await page.mouse.down()
  await sleep(1000)
  await page.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })))
  await sleep(1500)
  check((await leftovers()).length === 0, `${path}: leaving the window releases and resets`)
  await page.mouse.up()

  // 6. a press on a link never arms
  const link = await page.locator('main a[href]').first().boundingBox()
  if (link) {
    await page.mouse.move(link.x + link.width / 2, link.y + link.height / 2)
    await page.mouse.down()
    await sleep(800)
    const f = await floating()
    await page.mouse.up()
    await page.goto(base + path, { waitUntil: 'networkidle' })
    check(f.length === 0, `${path}: pressing a link does not start a hold`)
  }
}
console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'no page errors')
const video = page.video()
await ctx.close()
if (video) {
  const p = await video.path()
  renameSync(p, `${out}/hold-float.webm`)
  console.log(`video: docs/reference/screens/hold-float.webm`)
}
await browser.close()
process.exit(failed ? 1 : 0)
