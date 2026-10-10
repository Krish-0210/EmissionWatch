import { useEffect, useRef } from 'react'
import { HERO_VIEW, heroModel, latLon, lookFix } from '../lib/globeView'
import { heroGlobeScreen } from '../three/layout'

// Still image of the hero globe, drawn once on a 2D canvas from the same textures and colours as the
// 3D earth shader (land, borders, India, 2024 NO₂, graticule, day/night, teal rim and halo), at the
// 3D globe's exact screen position and starting orientation, so the 3D globe fades in over it with no
// jump. Shown while the 3D globe loads, with reduced motion, or without WebGL.

const TEX = `${import.meta.env.BASE_URL}textures/`
const SW = 1024, SH = 512 // texture sample resolution

async function pixels(name: string, w = SW, h = SH) {
  const blob = await (await fetch(TEX + name)).blob()
  const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  return ctx.getImageData(0, 0, w, h).data
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// India NO2 layer bounds (three/GlobeScene No2Layer): lon 68–98, lat 6–37.
const IN = { lon0: 68, lon1: 98, lat0: 6, lat1: 37, w: 512, h: 512 }

// Runs fn(deadline) in idle slices until it returns true (about 8 ms of work per slice), so painting
// the poster never blocks a frame. Returns a cancel function.
type Slice = (budgetEnd: number) => boolean
function inSlices(fn: Slice, done: () => void) {
  let cancelled = false
  const ric = (window as { requestIdleCallback?: (f: (d: { timeRemaining: () => number }) => void, o?: { timeout: number }) => number }).requestIdleCallback
  const step = (d?: { timeRemaining: () => number }) => {
    if (cancelled) return
    const budget = Math.max(4, Math.min(8, d ? d.timeRemaining() : 8))
    if (fn(performance.now() + budget)) done()
    else if (ric) ric(step, { timeout: 200 })
    else setTimeout(step, 16)
  }
  if (ric) ric(step, { timeout: 200 })
  else setTimeout(step, 16)
  return () => {
    cancelled = true
  }
}

// Paints the poster into cv in idle slices (row by row); returns a cancel function.
function paint(cv: HTMLCanvasElement, R: number, narrow: boolean, mask: Uint8ClampedArray, no2: Uint8ClampedArray, no2In: Uint8ClampedArray, done: () => void) {
  const pad = Math.round(R * 0.16)
  const size = 2 * (R + pad)
  // Work on an off-screen canvas; the visible one is swapped in when the whole image is ready.
  const work = document.createElement('canvas')
  work.width = size
  work.height = size
  const ctx = work.getContext('2d', { willReadFrequently: true })! // CPU-backed: getImageData below would read back from the GPU
  // Halo: soft teal ring just outside the limb (the 3D Halo sprite)
  const g = ctx.createRadialGradient(size / 2, size / 2, R * 0.93, size / 2, size / 2, R + pad)
  g.addColorStop(0, 'rgba(124,232,216,0)')
  g.addColorStop(0.32, 'rgba(124,232,216,0.32)')
  g.addColorStop(0.55, 'rgba(124,232,216,0.08)')
  g.addColorStop(1, 'rgba(124,232,216,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  const sun = [Math.cos(Math.PI - 0.62), 0.28, Math.sin(Math.PI - 0.62)]
  const sl = Math.hypot(sun[0], sun[1], sun[2])
  const { yaw, pitch } = HERO_VIEW
  const fix = lookFix(narrow)
  let py = 0
  const rows = (end: number) => {
    for (; py < size; py++) {
      if ((py & 7) === 0 && performance.now() > end) return false
      const vy = -(py + 0.5 - size / 2) / R
      for (let px = 0; px < size; px++) {
        const vx = (px + 0.5 - size / 2) / R
        const rr = vx * vx + vy * vy
        if (rr > 1) continue
        const vz = Math.sqrt(1 - rr)
        const [mx, my, mz] = heroModel(vx, vy, vz, yaw, pitch, fix)
        const [lat, lon] = latLon(mx, my, mz)
        const u = (lon + 180) / 360, v = (90 - lat) / 180
        const k = (Math.min(SH - 1, Math.floor(v * SH)) * SW + Math.min(SW - 1, Math.floor(u * SW))) * 4
        const land = mask[k] / 255, border = mask[k + 1] / 255, india = mask[k + 2] / 255
        const day = smooth(-0.06, 0.22, (vx * sun[0] + vy * sun[1] + vz * sun[2]) / sl)
        // Earth shader colours (three/GlobeScene.tsx earthShader)
        let r = (0.014 + (0.035 - 0.014) * day) * (1 - land) + (0.05 + 0.08 * day) * land
        let gg = (0.04 + 0.09 * day) * (1 - land) + (0.095 + 0.155 * day) * land
        let b = (0.062 + 0.118 * day) * (1 - land) + (0.11 + 0.16 * day) * land
        r += india * 0.03
        gg += india * 0.06
        b += india * 0.065
        const coast = smooth(0.25, 0.5, land) - smooth(0.5, 0.75, land)
        const indiaEdge = smooth(0.2, 0.5, india) - smooth(0.5, 0.8, india)
        const teal = coast * 0.16 + border * 0.22 + india * border * 0.25 + indiaEdge * 0.35
        // Graticule every 15° (distance to the nearest line in px, roughly)
        const fu = u * 24 - Math.floor(u * 24), fv = v * 12 - Math.floor(v * 12)
        const du = Math.min(fu, 1 - fu) * ((2 * Math.PI * R) / 24) * Math.cos((lat * Math.PI) / 180) * vz
        const dv = Math.min(fv, 1 - fv) * ((Math.PI * R) / 12) * vz
        const grid = du < 0.7 || dv < 0.7 ? 0.035 : 0
        r += 0.486 * (teal + grid)
        gg += 0.91 * (teal + grid)
        b += 0.847 * (teal + grid)
        // NO2 hotspots
        const na = (no2[k + 3] / 255) * 0.6
        r = r * (1 - na) + (no2[k] / 255) * (0.7 + 0.5 * (1 - day)) * na
        gg = gg * (1 - na) + (no2[k + 1] / 255) * (0.7 + 0.5 * (1 - day)) * na
        b = b * (1 - na) + (no2[k + 2] / 255) * (0.7 + 0.5 * (1 - day)) * na
        // India's higher-resolution NO2 layer on top (opacity ~0.85, colours x1.25)
        if (lon > IN.lon0 && lon < IN.lon1 && lat > IN.lat0 && lat < IN.lat1) {
          const iu = Math.floor(((lon - IN.lon0) / (IN.lon1 - IN.lon0)) * IN.w), iv = Math.floor(((IN.lat1 - lat) / (IN.lat1 - IN.lat0)) * IN.h)
          const q = (Math.min(IN.h - 1, iv) * IN.w + Math.min(IN.w - 1, iu)) * 4
          const ia = (no2In[q + 3] / 255) * 0.85
          r = r * (1 - ia) + Math.pow(no2In[q] / 255, 2.2) * 1.25 * ia
          gg = gg * (1 - ia) + Math.pow(no2In[q + 1] / 255, 2.2) * 1.25 * ia
          b = b * (1 - ia) + Math.pow(no2In[q + 2] / 255, 2.2) * 1.25 * ia
        }
        // Inner rim light
        const f = Math.pow(1 - vz, 3) * 0.2
        r += 0.486 * f
        gg += 0.91 * f
        b += 0.847 * f
        // Antialiased edge
        const a = Math.min(1, (1 - Math.sqrt(rr)) * R * 1.5)
        const o = (py * size + px) * 4
        // The earth shader writes these values straight to the screen (no colour-space conversion).
        d[o] = d[o] * (1 - a) + Math.min(255, r * 255) * a
        d[o + 1] = d[o + 1] * (1 - a) + Math.min(255, gg * 255) * a
        d[o + 2] = d[o + 2] * (1 - a) + Math.min(255, b * 255) * a
        d[o + 3] = Math.max(d[o + 3], a * 255)
      }
    }
    return true
  }
  return inSlices(rows, () => {
    ctx.putImageData(img, 0, 0)
    // Fresnel rim stroke
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, R - 0.5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(124,232,216,0.55)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    cv.width = size
    cv.height = size
    cv.getContext('2d')!.drawImage(work, 0, 0)
    done()
  })
}

export default function GlobePoster({ className = '' }: { className?: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = wrap.current, c = cv.current
    if (!el || !c || typeof createImageBitmap !== 'function') return
    let live = true
    let tex: [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] | null = null
    let lastR = 0
    let cancel = () => {}
    const place = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      const g = heroGlobeScreen(w, h)
      const R = Math.round(g.r)
      const pad = Math.round(R * 0.16)
      c.style.left = `${g.cx - R - pad}px`
      c.style.top = `${g.cy - R - pad}px`
      c.style.width = c.style.height = `${2 * (R + pad)}px`
      if (tex && Math.abs(R - lastR) > 2) {
        lastR = R
        cancel()
        cancel = paint(c, R, w < 768, tex[0], tex[1], tex[2], () => el.classList.add('drawn'))
      }
    }
    // Decode off-thread, then paint in idle slices.
    Promise.all([pixels('earth_mask.webp'), pixels('no2_world_2024.webp'), pixels('no2_india_2024.webp', IN.w, IN.h)])
      .then((t) => {
        if (!live) return
        tex = t
        place()
      })
      .catch(() => {})
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => {
      live = false
      cancel()
      ro.disconnect()
    }
  }, [])
  return (
    <div ref={wrap} className={`globe-poster ${className}`} aria-hidden="true">
      <canvas ref={cv} />
    </div>
  )
}
