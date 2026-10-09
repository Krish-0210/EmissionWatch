import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ClustersFile, SummaryFile } from '../api'
import { fmtInt } from '../lib/format'
import { holdNav, introFinished } from '../lib/intro'
import { setText } from '../lib/motion'
import { heroGlobeScreen } from '../three/layout'
import { LogoMark } from './Logo'
import '../styles/intro.css'

// "Emissions into orbit" (principles from docs/reference/analysis.md, original design). ~3.5 s.
//    0–0.9 s  thousands of ember particles (emissions) drift across a dark screen
//  0.7–1.7 s  they are pulled into four tilted orbit rings around the PanoptiCoal eye
//  1.6–2.4 s  the rings collapse into a dotted globe (land, ocean and the 11 clusters from the data)
//  2.1–2.7 s  a satellite streaks across, its scan line sweeping the globe
//  2.5–3.3 s  the globe glides to the hero position, the nav drops in, the 3D globe takes over
//      2.95 s hero copy: headline lines rise from a mask, lede and CTAs blur in, data chips appear
// Boot beat: until the 3D globe has drawn its first frame (or 1.5 s pass) only a compositor-driven
// CSS scan runs, so the 3D set-up (a long main-thread task) never freezes the particles. Click, key,
// wheel or Skip fast-forwards to the hand-off.
// Canvas 2D, one path fill per colour/alpha bucket per frame.

export type IntroBeat = 'warm' | 'nav' | 'land' | 'hero' | 'done'

interface Props {
  clusters?: ClustersFile
  summary?: SummaryFile
  reduced: boolean
  ready: boolean // the 3D globe has rendered once (or there is no 3D)
  onBeat: (b: IntroBeat) => void
}

const T = { warm: 2250, nav: 2500, land: 2850, hero: 2950, done: 3550, skipTo: 2380 }
const PALETTE = ['#ff8a3d', '#ffc24b', '#ff5a3c', '#7ce8d8', '#d8fff8', '#3e5a6b', '#e8edf2']
const EMBER = 0, AMBER = 1, HOT = 2, TEAL = 3, WHITE = 4, OCEAN = 5
const LEVELS = 6
const INDIA = { lat: 22.5, lon: 81.5 }
const RINGS = [
  { r: 0.55, inc: 62, psi: -20, w: 1.7, c: TEAL },
  { r: 0.76, inc: 72, psi: 35, w: -1.35, c: WHITE },
  { r: 0.96, inc: 66, psi: 100, w: 1.1, c: TEAL },
  { r: 1.16, inc: 76, psi: -65, w: -0.9, c: EMBER },
]
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const hash = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}
const rad = (d: number) => (d * Math.PI) / 180
// Same convention as three/geo.ts latLonToVec3 (kept three-free: the intro loads before the 3D chunk).
const vec = (lat: number, lon: number) => {
  const phi = rad(lon + 180), th = rad(90 - lat)
  return [-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)] as const
}
// GlobeScene starts at yaw = India's facing yaw − 0.9, pitch = 0.6 × India's facing pitch.
const INDIA_FACE = (() => {
  const [x, y, z] = vec(INDIA.lat, INDIA.lon)
  const yaw = Math.atan2(-x, z)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  return { yaw, pitch: Math.atan2(y, z1) }
})()

interface Particles {
  n: number
  sx: Float32Array; sy: Float32Array; sz: Float32Array // scatter (screen fraction) + size
  ring: Uint8Array; th: Float32Array; st: Float32Array // ring index, phase, stagger
  gx: Float32Array; gy: Float32Array; gz: Float32Array // unit sphere (globe lattice)
  kind: Uint8Array // 0 lattice, 1 cluster
  warm: Uint8Array // scatter colour
  land: Uint8Array // 0 ocean, 1 land, 2 India (filled from the earth mask when it loads)
}

function makeParticles(n: number, clusters: { lat: number; lon: number }[]): Particles {
  const p: Particles = {
    n,
    sx: new Float32Array(n), sy: new Float32Array(n), sz: new Float32Array(n),
    ring: new Uint8Array(n), th: new Float32Array(n), st: new Float32Array(n),
    gx: new Float32Array(n), gy: new Float32Array(n), gz: new Float32Array(n),
    kind: new Uint8Array(n), warm: new Uint8Array(n), land: new Uint8Array(n).fill(1),
  }
  const perCluster = clusters.length ? 10 : 0
  const lattice = n - perCluster * clusters.length
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    p.sx[i] = -0.08 + hash(i, 1) * 1.16
    p.sy[i] = -0.08 + hash(i, 2) * 1.16
    p.sz[i] = 0.7 + Math.pow(hash(i, 3), 3) * 2.2
    p.ring[i] = i % 4
    p.th[i] = hash(i, 4) * Math.PI * 2
    p.st[i] = hash(i, 5)
    p.warm[i] = hash(i, 6) < 0.62 ? EMBER : hash(i, 7) < 0.6 ? AMBER : HOT
    if (i < lattice) {
      const y = 1 - (2 * (i + 0.5)) / lattice, r = Math.sqrt(1 - y * y), a = i * golden
      p.gx[i] = Math.cos(a) * r
      p.gy[i] = y
      p.gz[i] = Math.sin(a) * r
    } else {
      const c = clusters[Math.floor((i - lattice) / perCluster)]
      const [x, y, z] = vec(c.lat + (hash(i, 8) - 0.5) * 1.6, c.lon + (hash(i, 9) - 0.5) * 1.6)
      p.gx[i] = x
      p.gy[i] = y
      p.gz[i] = z
      p.kind[i] = 1
    }
  }
  return p
}

// Land / India flags from the globe's own earth mask (R = land, B = India), decoded off-thread.
async function sampleLand(p: Particles) {
  const res = await fetch(`${import.meta.env.BASE_URL}textures/earth_mask.webp`)
  const bmp = await createImageBitmap(await res.blob(), { resizeWidth: 512, resizeHeight: 256, resizeQuality: 'low' })
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  const d = ctx.getImageData(0, 0, 512, 256).data
  for (let i = 0; i < p.n; i++) {
    // Inverse of vec(): lat from y, lon from x/z.
    const lat = Math.asin(p.gy[i]) * (180 / Math.PI)
    const lon = ((Math.atan2(p.gz[i], -p.gx[i]) * 180) / Math.PI - 180 + 540) % 360 - 180
    const u = Math.min(511, Math.floor(((lon + 180) / 360) * 512)), v = Math.min(255, Math.floor(((90 - lat) / 180) * 256))
    const k = (v * 512 + u) * 4
    p.land[i] = d[k + 2] > 120 ? 2 : d[k] > 120 ? 1 : 0
  }
}

function glowSprite(color: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, color)
  r.addColorStop(0.35, color.replace('1)', '0.35)'))
  r.addColorStop(1, color.replace('1)', '0)'))
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  return c
}

export default function Intro({ clusters, summary, reduced, ready, onBeat }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const eye = useRef<HTMLDivElement>(null)
  const status = useRef<HTMLSpanElement>(null)
  const pct = useRef<HTMLSpanElement>(null)
  const [geo] = useState(() => {
    const w = window.innerWidth, h = window.innerHeight
    const g = heroGlobeScreen(w, h)
    return { w, h, gx: g.cx, gy: g.cy, gr: g.r * 0.985, R0: Math.min(g.r, 0.34 * Math.min(w, h)), narrow: w < 768 }
  })
  const skipped = useRef(false)
  const started = useRef(false)
  const beatRef = useRef(onBeat)
  useEffect(() => {
    beatRef.current = onBeat
  })

  // Status lines from the real export; read by the frame loop through a ref.
  const plants = clusters?.clusters.reduce((a, x) => a + x.n_plants, 0)
  const mw = clusters?.clusters.reduce((a, x) => a + x.capacity_mw, 0)
  const statusLines = [
    clusters ? `Emissions · ${plants} plants · ${fmtInt(mw ?? 0)} MW self-reported` : 'Emissions · reading the plant registry',
    'Orbit lock · Sentinel-5P TROPOMI · daily NO₂',
    clusters ? `Globe · ${clusters.clusters.length} clusters · data as of ${clusters.as_of}` : 'Globe · loading clusters',
    summary ? `Scan · ${fmtInt(summary.pooled_model.enhancement.n)} cluster-days · ERA5 wind` : 'Scan · loading daily model',
  ]
  const lines = useRef(statusLines)
  const clusterPts = useRef<{ lat: number; lon: number }[]>([])
  useEffect(() => {
    lines.current = statusLines
    clusterPts.current = clusters?.clusters.map((c) => ({ lat: c.lat, lon: c.lon })) ?? []
  })

  // Hide the nav for the whole intro (it drops in at the 'nav' beat).
  useEffect(() => {
    holdNav(!reduced)
    return () => holdNav(false)
  }, [reduced])

  // Reduced motion: no particles, a short fade, everything at once.
  useEffect(() => {
    if (!reduced) return
    const b = beatRef.current
    ;(['warm', 'nav', 'land', 'hero'] as const).forEach(b)
    root.current?.classList.add('fade')
    const id = setTimeout(() => b('done'), 450)
    return () => {
      clearTimeout(id)
      introFinished()
    }
  }, [reduced])

  // Skip: jump to the hand-off and play the rest faster.
  useEffect(() => {
    if (reduced) return
    const el = root.current
    if (!el) return
    const skip = () => {
      skipped.current = true
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' && e.key !== 'Shift') skip()
    }
    el.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', skip, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', skip)
    }
  }, [reduced])

  // The frame loop starts once the 3D globe is ready (or after 1.2 s without it).
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), 1500)
    return () => clearTimeout(id)
  }, [])
  const go = ready || waited

  useEffect(() => {
    if (!go || reduced || started.current) return
    started.current = true
    const cv = canvas.current, el = root.current
    if (!cv || !el) return
    const { w, h, gx, gy, gr, R0, narrow } = geo
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const N = narrow ? 1300 : 2600
    const P = makeParticles(N, clusterPts.current)
    if ('createImageBitmap' in window) sampleLand(P).catch(() => {})
    const bokeh = glowSprite('rgba(255,150,80,1)')
    const satGlow = glowSprite('rgba(200,255,246,1)')
    // Per-bucket screen rects (x, y, size), reused every frame.
    const B = PALETTE.length * LEVELS
    const bx = Array.from({ length: B }, () => new Float32Array(N * 3))
    const bn = new Int32Array(B)
    const rings = RINGS.map((r) => ({ ...r, ci: Math.cos(rad(r.inc)), si: Math.sin(rad(r.inc)), cp: Math.cos(rad(r.psi)), sp: Math.sin(rad(r.psi)) }))
    const yawEnd = INDIA_FACE.yaw - 0.9, pitch = INDIA_FACE.pitch * 0.6
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch)
    const Cx = w / 2, Cy = narrow ? h * 0.46 : h / 2
    const fired = new Set<IntroBeat>()
    const beat = (b: IntroBeat) => {
      if (!fired.has(b)) {
        fired.add(b)
        beatRef.current(b)
      }
    }
    let line = -1
    let raf = 0
    let t = 0
    let rt = 0 // real time, for the drift
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(50, now - last)
      last = now
      rt += dt
      if (skipped.current && t < T.skipTo) t = T.skipTo
      t += dt * (skipped.current ? 1.8 : 1)

      // Beats
      if (t >= T.warm) beat('warm')
      if (t >= T.nav && !fired.has('nav')) {
        el.classList.add('leaving')
        beat('nav')
      }
      if (t >= T.land) beat('land')
      if (t >= T.hero) beat('hero')
      const li = t < 800 ? 0 : t < 1600 ? 1 : t < 2150 ? 2 : 3
      if (li !== line) {
        line = li
        setText(status.current, lines.current[li])
      }
      setText(pct.current, String(Math.round(clamp01(t / T.land) * 100)).padStart(3, '0'))

      // Glide: centre and radius move to the hero globe.
      const eg = ease(clamp01((t - T.nav) / 800))
      const cx = Cx + (gx - Cx) * eg, cy = Cy + (gy - Cy) * eg, R = R0 + (gr - R0) * eg
      // The overlay's own dark background lifts during the glide; the dots hand over to the 3D globe.
      el.style.setProperty('--bg-a', (1 - clamp01((t - T.nav) / 650)).toFixed(3))
      const dotsA = 1 - clamp01((t - 2950) / 450)
      // Globe spin settles onto the 3D globe's starting orientation.
      const yaw = yawEnd - 1.4 * (1 - ease(clamp01(t / 2900)))
      const cy0 = Math.cos(yaw), sy0 = Math.sin(yaw)
      // Scan line and satellite
      const us = clamp01((t - 2100) / 600)
      const scanY = cy - R + 2 * R * us
      const scanOn = t > 2100 && t < 2750

      bn.fill(0)
      const fadeIn = clamp01(t / 380)
      for (let i = 0; i < N; i++) {
        const s = P.st[i]
        const e1 = ease(clamp01((t - 700 - s * 420) / 900))
        const e2 = ease(clamp01((t - 1550 - s * 380) / 820))
        // Scatter: rising, wobbling emissions
        let x = P.sx[i] * w + Math.sin(rt * 0.0011 + i) * 6
        let y = P.sy[i] * h - rt * 0.018 * (0.4 + s)
        let size = P.sz[i]
        let col = P.warm[i]
        let a = fadeIn * (0.35 + 0.6 * hash(i, 11))
        if (e1 > 0) {
          const rg = rings[P.ring[i]]
          const th = P.th[i] + (rg.w * t) / 1000
          const c = Math.cos(th), sn = Math.sin(th)
          const rr = rg.r * R
          const rx = cx + rr * (c * rg.cp - sn * rg.ci * rg.sp)
          const ry = cy + rr * (c * rg.sp + sn * rg.ci * rg.cp)
          const depth = sn * rg.si // -1 back .. 1 front
          x += (rx - x) * e1
          y += (ry - y) * e1
          size += (1.1 + 0.6 * depth - size) * e1
          a += (0.45 + 0.4 * depth - a) * e1
          if (e1 > 0.55) col = rg.c
        }
        if (e2 > 0) {
          // Rotate the lattice point: yaw about Y, then pitch about X (as GlobeScene's Euler XYZ).
          const px = P.gx[i] * cy0 + P.gz[i] * sy0
          const pz0 = -P.gx[i] * sy0 + P.gz[i] * cy0
          const py = P.gy[i] * cosP - pz0 * sinP
          const pz = P.gy[i] * sinP + pz0 * cosP
          const lx = cx + px * R, ly = cy - py * R
          x += (lx - x) * e2
          y += (ly - y) * e2
          const front = pz > 0
          const land = P.land[i]
          const k = P.kind[i]
          const ga = k ? (front ? 1 : 0.15) : front ? (land ? 0.55 + 0.4 * pz : 0.16 + 0.1 * pz) : 0.06
          const gs = k ? 2.4 : land ? 1.5 : 1.1
          size += (gs - size) * e2
          a += (ga - a) * e2
          if (e2 > 0.5) col = k ? EMBER : land === 2 ? WHITE : land ? TEAL : OCEAN
          if (scanOn && front && Math.abs(ly - scanY) < 10) {
            a = Math.min(1, a + 0.45)
            if (!k) col = WHITE
          }
        }
        a *= dotsA
        if (a < 0.03 || x < -10 || y < -10 || x > w + 10 || y > h + 10) continue
        const b = col * LEVELS + Math.min(LEVELS - 1, Math.floor(a * LEVELS))
        const o = bn[b]++ * 3
        const arr = bx[b]
        arr[o] = x
        arr[o + 1] = y
        arr[o + 2] = size
      }

      ctx.clearRect(0, 0, w, h)
      // Bokeh: a few large soft embers in the scatter phase only
      const bk = (1 - clamp01((t - 500) / 600)) * fadeIn
      if (bk > 0.01) {
        for (let i = 0; i < 42; i++) {
          const s = 10 + hash(i, 21) * 26
          ctx.globalAlpha = bk * (0.08 + 0.18 * hash(i, 22))
          ctx.drawImage(bokeh, hash(i, 23) * w - s / 2, hash(i, 24) * h - s / 2 - rt * 0.03, s, s)
        }
      }
      for (let b = 0; b < B; b++) {
        const n = bn[b]
        if (!n) continue
        ctx.globalAlpha = ((b % LEVELS) + 0.5) / LEVELS
        ctx.fillStyle = PALETTE[Math.floor(b / LEVELS)]
        ctx.beginPath()
        const arr = bx[b]
        for (let j = 0; j < n * 3; j += 3) {
          const s = arr[j + 2]
          ctx.rect(arr[j] - s / 2, arr[j + 1] - s / 2, s, s)
        }
        ctx.fill()
      }
      // Scan line across the disc, and the satellite streak with its trail
      if (scanOn) {
        const dy = scanY - cy
        const half = Math.sqrt(Math.max(0, R * R - dy * dy))
        const fade = Math.sin(us * Math.PI)
        ctx.globalAlpha = 0.75 * fade
        const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0)
        g.addColorStop(0, 'rgba(124,232,216,0)')
        g.addColorStop(0.5, 'rgba(216,255,248,1)')
        g.addColorStop(1, 'rgba(124,232,216,0)')
        ctx.fillStyle = g
        ctx.fillRect(cx - half, scanY - 1, 2 * half, 2)
        const sx = cx - 1.6 * R + 3.2 * R * us, sy = cy - 1.05 * R + 0.5 * R * us
        const tg = ctx.createLinearGradient(sx - 0.9 * R, sy - 0.14 * R, sx, sy)
        tg.addColorStop(0, 'rgba(124,232,216,0)')
        tg.addColorStop(1, 'rgba(216,255,248,0.9)')
        ctx.strokeStyle = tg
        ctx.lineWidth = 1.5
        ctx.globalAlpha = fade
        ctx.beginPath()
        ctx.moveTo(sx - 0.9 * R, sy - 0.14 * R)
        ctx.lineTo(sx, sy)
        ctx.stroke()
        ctx.drawImage(satGlow, sx - 14, sy - 14, 28, 28)
      }
      ctx.globalAlpha = 1

      // The eye at the centre while the rings form, then it gives way to the globe.
      const ea = clamp01((t - 650) / 350) * (1 - clamp01((t - 1650) / 400))
      const e = eye.current
      if (e) {
        e.style.opacity = ea.toFixed(3)
        e.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${(0.85 + 0.25 * clamp01((t - 650) / 1000)).toFixed(3)})`
      }

      if (t >= T.done) {
        beat('done')
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      introFinished()
    }
  }, [go, reduced, geo])

  const eyeSize = Math.round(geo.R0 * 0.62)
  return createPortal(
    <div ref={root} className={`intro${reduced ? ' reduced' : ''}${go ? ' go' : ''}`} style={{ '--bg-a': 1 } as CSSProperties}>
      <canvas ref={canvas} className="intro-canvas" aria-hidden="true" />
      <div className="intro-boot" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div ref={eye} className="intro-eye" aria-hidden="true" style={{ width: eyeSize, height: eyeSize }}>
        <LogoMark size={eyeSize} animated />
      </div>
      <div className="intro-status" aria-hidden="true">
        <span className="intro-dot" />
        <span ref={status} className="intro-line">
          Initialising sensors
        </span>
        <span className="intro-pct mono">
          <span ref={pct}>000</span>%
        </span>
      </div>
      <button type="button" className="intro-skip" onClick={() => (skipped.current = true)}>
        Skip intro <span aria-hidden="true">→</span>
      </button>
      <span className="sr-only" role="status">
        PanoptiCoal. Coal plants report their own pollution. We watch from space.
      </span>
    </div>,
    document.body,
  )
}
