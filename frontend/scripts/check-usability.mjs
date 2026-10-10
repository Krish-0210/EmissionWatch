// Usability checks: keyboard-only navigation on every page (skip link, tab order, every focused
// element visible, named and with a focus indicator, nothing focusable inside hidden UI), the phone
// menu by keyboard, the intro (Sound on/off question, one-click skip, nav reachable right after),
// the one-time hold tip, and a purpose line + primary action at the top of every page.
// Needs a preview server (default 4173).   node scripts/check-usability.mjs [baseUrl]
import { chromium } from 'playwright'

const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`)
  if (!ok) failed++
}
const PAGES = ['/?intro=0', '/map', '/cluster/talcher', '/near-me', '/how-it-works', '/limits', '/nope']

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []

// What the focused element looks like to a keyboard user.
const describe = () => {
  const el = document.activeElement
  if (!el || el === document.body) return null
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim()
  const hidden = !!el.closest('[inert], [aria-hidden="true"]') || cs.visibility === 'hidden' || (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
  const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'
  const onScreen = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
  return { tag: el.tagName.toLowerCase(), cls: String(el.className?.baseVal ?? el.className).split(' ')[0], name: name.slice(0, 40), hidden, ring, onScreen }
}

for (const [w, h] of [[1440, 900], [375, 812]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  await ctx.addInitScript(() => {
    localStorage.setItem('pc-hold-seen', '1')
    localStorage.setItem('pc-sound', 'off')
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${w}: ${e.message}`))
  for (const path of PAGES) {
    await page.goto(base + path, { waitUntil: 'networkidle' })
    await sleep(900)
    // Purpose line + primary action at the top
    const top = await page.evaluate(() => {
      const h1 = document.querySelector('main h1')
      const lede = document.querySelector('main .lede, main .page-purpose, main .hero-lede')
      const act = [...document.querySelectorAll('main .pill, main .near-select')].find((e) => e.getBoundingClientRect().top < 1400)
      return { h1: !!h1 && h1.textContent.trim().length > 0, lede: !!lede, action: act ? (act.textContent || act.id).trim().slice(0, 40) : null }
    })
    check(top.h1 && top.lede && !!top.action, `${w} ${path}: heading + one-line purpose + primary action (${top.action ?? 'none'})`)
    // Keyboard: first Tab = skip link; then walk the tab order
    await page.keyboard.press('Tab')
    const first = await page.evaluate(describe)
    check(first?.cls === 'skip', `${w} ${path}: first Tab focuses "Skip to content"`)
    const seen = []
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press('Tab')
      await sleep(30)
      let d = await page.evaluate(describe)
      if (!d) continue
      // an entrance that focus just triggered: judge what the user sees once it has faded in
      if (d.hidden || !d.onScreen) {
        await sleep(350)
        d = (await page.evaluate(describe)) ?? d
      }
      seen.push(d)
    }
    const bad = seen.filter((d) => d.hidden || !d.name || !d.ring || !d.onScreen)
    check(seen.length > 5 && bad.length === 0, `${w} ${path}: ${seen.length} tab stops, all visible, named, with a focus ring${bad.length ? ' — problems: ' + bad.slice(0, 6).map((d) => `${d.tag}.${d.cls}[${d.name}]${d.hidden ? ' hidden' : ''}${!d.ring ? ' no-ring' : ''}${!d.onScreen ? ' off-screen' : ''}${!d.name ? ' no-name' : ''}`).join(', ') : ''}`)
  }
  // Skip link moves focus into main
  await page.goto(base + '/how-it-works', { waitUntil: 'networkidle' })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await sleep(300)
  await page.keyboard.press('Tab')
  const inMain = await page.evaluate(() => !!document.activeElement?.closest('main'))
  check(inMain, `${w}: skip link -> next Tab lands in main content`)
  if (w < 1024) {
    // Phone menu by keyboard
    await page.focus('.nav-toggle')
    await page.keyboard.press('Enter')
    await sleep(500)
    const m = await page.evaluate(() => ({ open: document.querySelector('.nav-menu')?.classList.contains('open'), focus: document.activeElement?.textContent }))
    check(m.open && /Home/.test(m.focus ?? ''), `${w}: menu opens from the keyboard, focus on the first link`)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await sleep(900)
    check(new URL(page.url()).pathname === '/map', `${w}: keyboard Tab + Enter in the menu navigates (${new URL(page.url()).pathname})`)
  }
  await ctx.close()
}

// Intro: sound question, one-click skip, nav right after; no choice = sound off
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(base + '/', { waitUntil: 'commit' })
  await page.waitForSelector('.intro-ask', { timeout: 5000 }).catch(() => {})
  const ask = await page.evaluate(() => [...document.querySelectorAll('.intro-ask button')].map((b) => b.textContent))
  check(ask.join('|') === 'Sound on|Sound off', `intro asks "Sound on / Sound off" (${ask.join(' / ')})`)
  const pref0 = await page.evaluate(() => localStorage.getItem('pc-sound'))
  await page.click('.intro-skip')
  const t0 = Date.now()
  await page.waitForFunction(() => !document.documentElement.classList.contains('intro-hold') && !document.querySelector('.intro'), null, { timeout: 4000 }).catch(() => {})
  const gone = Date.now() - t0
  check(gone < 2500, `intro gone ${gone} ms after one click on "Skip intro"`)
  await page.click('.nav-links a[href="/limits"]', { timeout: 3000 }).catch(() => {})
  await sleep(1200)
  check(new URL(page.url()).pathname === '/limits', 'nav works right after skipping')
  const on = await page.evaluate(() => document.querySelector('.sound-toggle')?.getAttribute('aria-pressed'))
  check(pref0 === null && on === 'false', `no sound choice = sound off (toggle aria-pressed ${on}), toggle in the nav`)
  await ctx.close()
}

// Hold tip: once, dismissible
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(base + '/how-it-works', { waitUntil: 'networkidle' })
  await page.mouse.move(600, 400)
  const shown = await page.waitForSelector('.hold-tip', { timeout: 8000 }).then(() => true, () => false)
  check(shown, 'hold tip appears on a first visit')
  await page.click('.ht-x').catch(() => {})
  await sleep(300)
  const goneTip = await page.evaluate(() => !document.querySelector('.hold-tip'))
  await page.goto(base + '/map', { waitUntil: 'networkidle' })
  await sleep(5000)
  const again = await page.evaluate(() => !!document.querySelector('.hold-tip'))
  check(goneTip && !again, 'hold tip dismissed with "Got it" and not shown again')
  await ctx.close()
}

console.log(errors.length ? `page errors:\n  ${errors.join('\n  ')}` : 'no page errors')
await browser.close()
process.exit(failed ? 1 : 0)
