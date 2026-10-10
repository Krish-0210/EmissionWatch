// Sound check: taps everything that reaches the speakers (AudioNode.connect to destination) into an
// analyser and reports RMS / peak per phase: bed, hover ticks, click chirp, toggle, hold + blast,
// page transition. Needs a server (default http://localhost:4173).
//   node scripts/check-sound.mjs [baseUrl]
import { chromium } from 'playwright'

const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const HOOK = `(() => {
  const meter = (window.__meter = { rms: [], t0: performance.now() });
  const orig = AudioNode.prototype.connect;
  const taps = new WeakMap();
  AudioNode.prototype.connect = function (target, ...rest) {
    const r = orig.call(this, target, ...rest);
    try {
      if (target === this.context.destination && !taps.has(this.context)) {
        const an = this.context.createAnalyser(); an.fftSize = 2048;
        orig.call(this, an);
        taps.set(this.context, an);
        const buf = new Float32Array(an.fftSize);
        setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let s = 0, pk = 0; for (const v of buf) { s += v * v; pk = Math.max(pk, Math.abs(v)); }
          meter.rms.push([Math.round(performance.now() - meter.t0), Math.sqrt(s / buf.length), pk]);
        }, 25);
      }
    } catch (e) {}
    return r;
  };
})();`

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=user-gesture-required'] }).catch(() => chromium.launch({ headless: true }))
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(HOOK)
// Sound is off until chosen; these measurements are of the "Sound on" choice.
await ctx.addInitScript(() => localStorage.getItem('pc-sound') || localStorage.setItem('pc-sound', 'on'))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => page.evaluate(() => Math.round(performance.now() - window.__meter.t0))
const marks = []
const mark = async (name) => marks.push([name, await now()])

await page.goto(base + '/?intro=0', { waitUntil: 'networkidle' })
await sleep(1500)
await mark('silent-before-gesture')
await sleep(800)
await page.mouse.click(700, 120) // first gesture: unlock
await mark('bed-fade-in')
await sleep(3200)
await mark('bed')
await sleep(1500)
await mark('hovers')
const links = await page.locator('.nav-links a').all()
for (const l of links.slice(0, 5)) {
  await l.hover()
  await sleep(160)
}
await page.mouse.move(700, 600)
await sleep(300)
await mark('click')
await page.mouse.click(700, 600)
await sleep(600)
await mark('hold')
const holdZone = await page.locator('[data-hold]').first().boundingBox().catch(() => null)
if (holdZone) {
  const x = holdZone.x + holdZone.width * 0.62, y = holdZone.y + holdZone.height * 0.55
  await page.mouse.move(x, y)
  await page.mouse.down()
  await sleep(3800)
  await mark('blast')
  await page.mouse.up()
  await sleep(2600)
}
await mark('toggle-off')
await page.locator('.sound-toggle').first().click()
await sleep(1200)
await mark('off')
await sleep(1000)
await mark('end')

const rms = await page.evaluate(() => window.__meter.rms)
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf')
console.log('phase                 rms(dBFS)  peak(dBFS)  samples')
for (let i = 0; i < marks.length - 1; i++) {
  const [name, a] = marks[i], b = marks[i + 1][1]
  const s = rms.filter((r) => r[0] >= a && r[0] < b)
  const r = s.length ? Math.sqrt(s.reduce((q, x) => q + x[1] * x[1], 0) / s.length) : 0
  const pk = s.reduce((q, x) => Math.max(q, x[2]), 0)
  console.log(name.padEnd(22), db(r).padStart(8), db(pk).padStart(11), String(s.length).padStart(8))
}
const peak = rms.reduce((q, x) => Math.max(q, x[2]), 0)
console.log('overall peak', db(peak), 'dBFS', peak > 0.999 ? '(CLIPPING)' : '')
console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'no console errors')
await browser.close()
