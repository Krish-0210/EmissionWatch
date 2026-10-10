// Performance profile: Chrome DevTools Protocol trace + rAF frame log while the intro plays, while
// scrolling every page, while hovering and during hold/release. Lists FPS per scenario and the worst
// long frames with the main-thread / GPU work inside them. Needs a preview server (default 4173).
//   node scripts/profile.mjs [baseUrl] [--only=home,map] [--frames=8] [--json=out.json] [--headed] [--dpr=1.5] [--css='...']
// Tip: profile an unminified build for readable function names:
//   npx vite build --minify false --outDir dist-prof && npx vite preview --outDir dist-prof --port 4174
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173'
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const topN = +(args.find((a) => a.startsWith('--frames='))?.slice(9) ?? 8)
const jsonOut = args.find((a) => a.startsWith('--json='))?.slice(7)
const css = args.find((a) => a.startsWith('--css='))?.slice(6) // A/B: inject CSS (e.g. hide a layer)
const dpr = +(args.find((a) => a.startsWith('--dpr='))?.slice(6) ?? 1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const LONG_MS = 25 // a frame over 25 ms is under 40 fps

const SCENARIOS = [
  // boot: the loader beat (GPU set-up of the 3D globe happens behind it); stats after it are reported too
  { id: 'intro', path: '/', run: async () => sleep(7000), boot: 2000 },
  { id: 'home', path: '/?intro=0', run: scrollAll },
  { id: 'home-hover', path: '/?intro=0', run: hover },
  { id: 'hold', path: '/?intro=0', run: hold },
  { id: 'map', path: '/map', run: scrollAll },
  { id: 'cluster', path: '/cluster/talcher', run: scrollAll },
  { id: 'near-me', path: '/near-me', run: scrollAll },
  { id: 'how', path: '/how-it-works', run: scrollAll },
  { id: 'limits', path: '/limits', run: scrollAll },
  { id: 'inner-hover', path: '/how-it-works', run: hover },
].filter((s) => !only || only.includes(s.id))

// Wheel down the whole page in 120 px steps (Lenis smooths it), then back up a third.
async function scrollAll(p) {
  await p.mouse.move(720, 450)
  const h = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  const steps = Math.min(220, Math.ceil(h / 120) + 10)
  for (let i = 0; i < steps; i++) {
    await p.mouse.wheel(0, 120)
    await sleep(45)
  }
  await sleep(600)
  for (let i = 0; i < steps / 3; i++) {
    await p.mouse.wheel(0, -120)
    await sleep(45)
  }
  await sleep(600)
}

// Sweep the pointer over the visible page in rows (cards, links, pills, globe), then scroll a bit and repeat.
async function hover(p) {
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 90; y < 880; y += 110)
      for (let x = 40; x <= 1400; x += 40) {
        await p.mouse.move(x, y)
        await sleep(8)
      }
    for (let i = 0; i < 8; i++) {
      await p.mouse.wheel(0, 120)
      await sleep(40)
    }
    await sleep(300)
  }
}

async function hold(p) {
  const zone = await p.locator('[data-hold]').first().boundingBox()
  const x = Math.round(zone.x + zone.width * 0.66), y = Math.round(zone.y + Math.min(zone.height, 900 - zone.y) * 0.5)
  await p.mouse.move(x, y, { steps: 6 })
  await sleep(400)
  await p.mouse.down()
  await sleep(3900)
  await p.mouse.up()
  await sleep(1600)
}

// In-page frame log: a user-timing mark at the end of every long frame lets the trace be cut per frame.
const FRAME_LOG = () => {
  window.__ft = []
  let last = performance.now()
  const f = (now) => {
    const d = now - last
    window.__ft.push(d)
    if (d > 25) performance.mark(`long|${d.toFixed(1)}|${Math.round(scrollY)}`)
    last = now
    if (!window.__stop) requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
}

const CATS = [
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'blink.user_timing', 'v8.execute', 'gpu', 'viz', 'cc', 'toplevel',
].join(',')

async function trace(cdp, fn) {
  const chunks = []
  cdp.on('Tracing.dataCollected', (e) => chunks.push(...e.value))
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.start', { categories: CATS, transferMode: 'ReportEvents' })
  await fn()
  await cdp.send('Tracing.end')
  await done
  return chunks
}

const INTERESTING = new Set([
  'FunctionCall', 'FireAnimationFrame', 'TimerFire', 'EventDispatch', 'UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint',
  'Layerize', 'UpdateLayer', 'Commit', 'ParseHTML', 'MajorGC', 'MinorGC', 'V8.GC_SCAVENGER', 'V8.GC_MARK_COMPACTOR',
  'ScheduleStyleRecalculation', 'HitTest', 'Decode Image', 'RasterTask', 'GPUTask', 'CompositeLayers', 'ImageDecodeTask',
  'v8.compile', 'v8.parseOnBackground', 'EvaluateScript', 'v8.callFunction', 'IntersectionObserverController::computeIntersections',
  'Animation', 'PaintImage', 'ThreadControllerImpl::RunTask',
])

function analyse(events) {
  const threads = new Map() // pid:tid -> name
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name)
  const marks = events.filter((e) => e.cat?.includes('blink.user_timing') && e.name?.startsWith('long|'))
  const pid = marks[0]?.pid
  const tname = (e) => threads.get(`${e.pid}:${e.tid}`) ?? '?'
  const work = events.filter((e) => e.ph === 'X' && e.dur > 200 && (INTERESTING.has(e.name) || e.name.startsWith('V8.GC')))
  const label = (e) => {
    const d = e.args?.data
    if (e.name === 'FunctionCall' && d) return `FunctionCall ${d.functionName || '(anon)'} ${String(d.url ?? '').split('/').pop()}:${d.lineNumber ?? ''}`
    if (e.name === 'EventDispatch' && d) return `EventDispatch ${d.type}`
    if (e.name === 'TimerFire') return 'TimerFire'
    return e.name
  }
  const frames = []
  // de-duplicate marks (begin/end pairs, 'R' and 'b' phases)
  const seen = new Set()
  for (const m of marks) {
    if (seen.has(m.ts)) continue
    seen.add(m.ts)
    const dur = parseFloat(m.name.split('|')[1])
    const t1 = m.ts, t0 = m.ts - dur * 1000
    const agg = new Map()
    for (const e of work) {
      const a = Math.max(e.ts, t0), b = Math.min(e.ts + e.dur, t1)
      if (b <= a) continue
      const th = tname(e)
      if (e.pid === pid && th !== 'CrRendererMain' && th !== 'Compositor' && !th.startsWith('CompositorTileWorker')) continue
      if (e.pid !== pid && !['CrGpuMain', 'VizCompositorThread'].includes(th)) continue
      if (e.name === 'ThreadControllerImpl::RunTask' && th === 'CrRendererMain') continue
      const k = `${th === 'CrRendererMain' ? 'main' : th.startsWith('CompositorTileWorker') ? 'raster' : th}: ${label(e)}`
      agg.set(k, (agg.get(k) ?? 0) + (b - a) / 1000)
    }
    frames.push({ dur, y: m.name.split("|")[2], at: m.ts, top: [...agg].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(1)}ms`) })
  }
  // totals over the whole scenario (main thread)
  const totals = new Map()
  for (const e of work) {
    if (e.pid !== pid || tname(e) !== 'CrRendererMain' || e.name === 'ThreadControllerImpl::RunTask' || e.name === 'FunctionCall') continue
    totals.set(e.name, (totals.get(e.name) ?? 0) + e.dur / 1000)
  }
  const gpu = events.filter((e) => e.ph === 'X' && tname(e) === 'CrGpuMain' && e.name === 'GPUTask').reduce((s, e) => s + e.dur / 1000, 0)
  // repaints by DOM node (backend node id), main thread
  const paints = new Map()
  for (const e of work) {
    if (e.name !== 'Paint' || e.pid !== pid) continue
    const id = e.args?.data?.nodeId
    const p = paints.get(id) ?? { n: 0, ms: 0, area: 0 }
    p.n++
    p.ms += e.dur / 1000
    const c = e.args?.data?.clip
    if (c) p.area += Math.abs((c[2] - c[0]) * (c[5] - c[1]))
    paints.set(id, p)
  }
  const t0 = events.find((e) => e.ts > 0 && e.ph === 'X')?.ts ?? 0
  frames.forEach((f) => (f.t = Math.round((f.at - t0) / 1000)))
  return { frames: frames.sort((a, b) => b.dur - a.dur), totals: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 8), gpu, paints: [...paints].sort((a, b) => b[1].area - a[1].area).slice(0, 8) }
}

// --headed: a real window (vsync-paced like a user's browser) placed off-screen so it does not get in the way.
const headed = args.includes('--headed')
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !headed,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', ...(headed ? ['--window-position=-2600,0', '--window-size=1460,1000', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] : [])],
})
const report = []
for (const s of SCENARIOS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr })
  const p = await ctx.newPage()
  await p.addInitScript(() => {
    localStorage.setItem('pc-hold-seen', '1')
    localStorage.setItem('pc-sound', 'off')
    localStorage.setItem('pc-sound-asked', '1')
  })
  if (css) await p.addInitScript((c) => document.addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: c }))), css)
  if (s.id === 'intro') await p.addInitScript(FRAME_LOG)
  await p.goto(base + s.path, { waitUntil: s.id === 'intro' ? 'commit' : 'networkidle' })
  if (s.id !== 'intro') {
    await sleep(2500)
    await p.evaluate(FRAME_LOG)
  }
  const cdp = await ctx.newCDPSession(p)
  const events = await trace(cdp, () => s.run(p))
  const dump = args.find((a) => a.startsWith('--trace='))?.slice(8)
  if (dump) writeFileSync(`${dump}-${s.id}.json`, JSON.stringify(events))
  const ft = await p.evaluate(() => {
    window.__stop = true
    return window.__ft.slice(2)
  })
  const sorted = [...ft].sort((a, b) => a - b)
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length
  const fps = 1000 / avg
  // worst 1-second window
  let worst = Infinity
  for (let i = 0, j = 0, sum = 0; j < ft.length; j++) {
    sum += ft[j]
    while (sum > 1000 && i < j) sum -= ft[i++]
    if (sum > 900) worst = Math.min(worst, (j - i + 1) / (sum / 1000))
  }
  let after = ''
  if (s.boot) {
    let acc = 0
    const rest = ft.filter((d) => (acc += d) > s.boot)
    const avgR = rest.reduce((x, y) => x + y, 0) / rest.length
    let w = Infinity
    for (let i = 0, j = 0, sum = 0; j < rest.length; j++) {
      sum += rest[j]
      while (sum > 1000 && i < j) sum -= rest[i++]
      if (sum > 900) w = Math.min(w, (j - i + 1) / (sum / 1000))
    }
    after = `after boot: ${(1000 / avgR).toFixed(1)} fps avg, worst 1 s ${w.toFixed(1)}, max ${Math.max(...rest).toFixed(0)} ms, ${rest.filter((v) => v > LONG_MS).length} long`
  }
  const a = analyse(events)
  await cdp.send('DOM.getDocument', { depth: 0 }).catch(() => {})
  const paintBy = []
  for (const [id, p] of a.paints) {
    let who = String(id)
    try {
      const { node } = await cdp.send('DOM.describeNode', { backendNodeId: id })
      const cls = (node.attributes ?? []).reduce((s, v, i, arr) => (arr[i - 1] === 'class' ? v : s), '')
      who = `${node.localName || node.nodeName}${cls ? '.' + cls.split(' ').slice(0, 2).join('.') : ''}`
    } catch {}
    paintBy.push(`${who} ×${p.n} ${(p.area / 1e6).toFixed(0)}Mpx ${p.ms.toFixed(0)}ms`)
  }
  const r = {
    id: s.id, frames: ft.length, fps: +fps.toFixed(1), worst1s: +(worst === Infinity ? fps : worst).toFixed(1),
    p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), max: +sorted[sorted.length - 1].toFixed(1),
    long: ft.filter((v) => v > LONG_MS).length, gpuMs: +a.gpu.toFixed(0), totals: a.totals.map(([k, v]) => `${k} ${v.toFixed(0)}ms`),
    worstFrames: a.frames.slice(0, topN),
    after,
  }
  report.push(r)
  console.log(`\n== ${r.id}: ${r.fps} fps avg, worst 1 s ${r.worst1s} fps, p95 ${r.p95} ms, max ${r.max} ms, ${r.long} frames > ${LONG_MS} ms, GPU main ${r.gpuMs} ms`)
  if (after) console.log(`   ${after}`)
  console.log(`   main totals: ${r.totals.join(' · ')}`)
  console.log(`   repaints: ${paintBy.join(' · ')}`)
  for (const f of r.worstFrames) console.log(`   ${f.dur.toFixed(0)} ms @${f.t}ms y=${f.y}: ${f.top.join(' | ') || '(no traced work: GPU/compositor or idle)'}`)
  await ctx.close()
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1))
console.log('\nSUMMARY')
for (const r of report) console.log(`${r.id.padEnd(12)} ${String(r.fps).padStart(6)} fps  worst1s ${String(r.worst1s).padStart(6)}  p95 ${String(r.p95).padStart(5)} ms  long ${r.long}${r.after ? `  (${r.after})` : ''}`)
await browser.close()
