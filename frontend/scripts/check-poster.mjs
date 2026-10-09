// Poster vs 3D globe at the same spot: screenshot before the 3D mounts and after. Needs preview on 4173.
//   node scripts/check-poster.mjs <outDir>
import { chromium } from 'playwright'
const out = process.argv[2]
const b = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist'] })
for (const [w, h, id] of [[1440, 900, 'd'], [375, 812, 'm']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.goto('http://localhost:4173/?intro=0', { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500) // poster drawn, 3D not mounted yet (no intent, < 2.5 s)
  await p.screenshot({ path: `${out}/poster-${id}.png` })
  await p.mouse.move(200, 200)
  await p.waitForTimeout(3000)
  await p.screenshot({ path: `${out}/globe3d-${id}.png` })
  await p.close()
}
const r = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
await r.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await r.waitForTimeout(2000)
await r.screenshot({ path: `${out}/poster-reduced.png` })
await b.close()
