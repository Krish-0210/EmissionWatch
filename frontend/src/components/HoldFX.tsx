import { useEffect, useRef } from 'react'
import { gsap } from '../lib/gsap'
import { BLAST_MS, HOLD_EXCLUDE, HOLD_FULL, holdState, markHoldSeen } from '../lib/hold'
import { useMediaQuery, useReducedMotion } from '../lib/motion'
import { sound } from '../lib/sound'

// "Hold to scan deeper" (click-and-hold, desktop only, off for reduced motion). Pressing on a
// [data-hold] zone (not on a control) charges a scan over ~3.6 s:
//   the page (nav + main + footer) tilts in 3D, zooms toward the pointer and starts to shake,
//   headings split into red/teal fringes, a scanning lens opens with the satellite pixel grid
//   inside it and NO₂ hotspot cells flaring, fracture lines grow out from the pointer and glass
//   shards break away toward the viewer, warp streaks rush outward, and at full charge an arc
//   crackles across the lens (the 3D globe's plumes flare and its camera dives, see GlobeScene).
// Releasing fires a pulse: flash, a chromatic shockwave, sparks; shards fly back and the page
// springs back to rest with overshoot. Sound: lib/sound holdStart / holdRelease.
// One full-viewport Canvas 2D, drawn only while a hold or its release is running; DOM changes are
// transforms on three elements plus a quantised CSS variable (few repaints).

const GRID = 16 // px, the lens pixel grid
const TAU = Math.PI * 2

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2)

interface Crack { pts: number[]; len: number[]; total: number; d: number }
interface Shard { bx: number; by: number; vx: number; vy: number; verts: number[]; spin: number; grow: number; th: number; kRel: number }
interface Spark { a: number; v: number; c: number; s: number }
interface Geo { cracks: Crack[]; shards: Shard[]; hot: [number, number, number][]; streaks: [number, number, number][]; sparks: Spark[] }

function makeGeo(x: number, y: number, seed: number): Geo {
  const r = rng(seed)
  const cracks: Crack[] = []
  const nb = 11
  const branch = (sx: number, sy: number, a0: number, segs: number, l0: number, d: number) => {
    const pts = [sx, sy], len = [0]
    let ax = sx, ay = sy, a = a0, tot = 0
    for (let i = 0; i < segs; i++) {
      a += (r() - 0.5) * 0.9
      const l = l0 * (0.6 + r() * 0.8)
      ax += Math.cos(a) * l
      ay += Math.sin(a) * l
      tot += l
      pts.push(ax, ay)
      len.push(tot)
    }
    cracks.push({ pts, len, total: tot, d })
    return pts
  }
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + r() * 0.5
    const pts = branch(x, y, a, 7 + Math.floor(r() * 4), 34 + r() * 30, r() * 0.25)
    if (r() < 0.7) {
      const k = 2 + Math.floor(r() * 3) * 2
      branch(pts[k], pts[k + 1], a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), 3 + Math.floor(r() * 3), 22 + r() * 18, 0.25 + r() * 0.35)
    }
  }
  const shards: Shard[] = []
  for (let i = 0; i < 38; i++) {
    const rad = 26 + Math.pow(r(), 0.75) * 300, th = r() * TAU
    // Splinters: long, thin, slightly irregular quads/triangles oriented roughly along the radius.
    const verts: number[] = []
    const n = r() < 0.6 ? 3 : 4
    const along = th + (r() - 0.5) * 1.2, long = 18 + r() * 46, wide = 5 + r() * 14
    for (let k = 0; k < n; k++) {
      const va = (k / n) * TAU + (r() - 0.5) * 0.7
      const lx = Math.cos(va) * long * (0.6 + r() * 0.4), ly = Math.sin(va) * wide * (0.6 + r() * 0.6)
      verts.push(lx * Math.cos(along) - ly * Math.sin(along), lx * Math.sin(along) + ly * Math.cos(along))
    }
    const da = th + (r() - 0.5) * 0.5
    shards.push({ bx: x + Math.cos(th) * rad, by: y + Math.sin(th) * rad, vx: Math.cos(da), vy: Math.sin(da), verts, spin: (r() - 0.5) * 5, grow: 1.2 + r() * 2.4, th: 0.08 + (rad / 330) * 0.45 + r() * 0.25, kRel: 0 })
  }
  const hot: [number, number, number][] = []
  for (let i = 0; i < 10; i++) {
    const a = r() * TAU, d = 20 + r() * 150
    hot.push([Math.round((x + Math.cos(a) * d) / GRID) * GRID, Math.round((y + Math.sin(a) * d) / GRID) * GRID, r()])
  }
  const streaks: [number, number, number][] = []
  for (let i = 0; i < 52; i++) streaks.push([r() * TAU, r(), 0.4 + r() * 0.9])
  const sparks: Spark[] = []
  for (let i = 0; i < 96; i++) sparks.push({ a: r() * TAU, v: 380 + r() * 1300, c: r() < 0.55 ? 0 : r() < 0.6 ? 1 : 2, s: 1.4 + r() * 2.2 })
  return { cracks, shards, hot, streaks, sparks }
}

function bolt(x0: number, y0: number, x1: number, y1: number, depth: number, out: number[], r: () => number) {
  if (depth === 0) {
    out.push(x1, y1)
    return
  }
  const mx = (x0 + x1) / 2 + (r() - 0.5) * Math.hypot(x1 - x0, y1 - y0) * 0.35
  const my = (y0 + y1) / 2 + (r() - 0.5) * Math.hypot(x1 - x0, y1 - y0) * 0.35
  bolt(x0, y0, mx, my, depth - 1, out, r)
  bolt(mx, my, x1, y1, depth - 1, out, r)
}

export default function HoldFX() {
  const fine = useMediaQuery('(pointer: fine) and (min-width: 768px)')
  const reduced = useReducedMotion()
  const cv = useRef<HTMLCanvasElement>(null)
  const readout = useRef<HTMLDivElement>(null)
  const depth = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const canvas = cv.current, ro = readout.current
    if (!fine || reduced || !canvas || !ro) return
    const ctx = canvas.getContext('2d')!
    const root = document.documentElement
    let W = 0, H = 0, dpr = 1
    let phase: 'idle' | 'armed' | 'hold' | 'release' = 'idle'
    let armTimer = 0
    let downX = 0, downY = 0
    let startT = 0, relT = 0, relLevel = 0
    let ox = 0, oy = 0 // transform origin (viewport) = where the hold started
    let geo: Geo | null = null
    let targets: { el: HTMLElement; left: number; top: number }[] = []
    let rel = { rz: 0, rx: 0, ry: 0, s: 0, tx: 0, ty: 0 }
    let lastCa = -1
    let boltPts: number[] = []
    let boltAt = 0
    let suppressClick = false
    const r = rng(7)

    const size = () => {
      W = window.innerWidth
      H = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 1.25)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const setCa = (px: number) => {
      const q = Math.round(px * 2) / 2
      if (q === lastCa) return
      lastCa = q
      root.style.setProperty('--ca', `${q}px`)
    }

    const applyDom = (rz: number, rx: number, ry: number, s: number, tx: number, ty: number) => {
      for (const t of targets) {
        t.el.style.transformOrigin = `${(ox - t.left).toFixed(1)}px ${(oy - t.top).toFixed(1)}px`
        t.el.style.transform = `perspective(1400px) translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg) rotateZ(${rz.toFixed(3)}deg) scale(${(1 + s).toFixed(4)})`
      }
    }
    const clearDom = () => {
      for (const t of targets) {
        t.el.style.transform = ''
        t.el.style.transformOrigin = ''
        t.el.style.willChange = ''
      }
      targets = []
      root.classList.remove('holding')
      root.style.removeProperty('--ca')
      lastCa = -1
    }

    const begin = () => {
      phase = 'hold'
      startT = performance.now()
      ox = holdState.x
      oy = holdState.y
      holdState.holding = true
      holdState.level = 0
      geo = makeGeo(ox, oy, (Math.random() * 1e9) | 0)
      targets = ['.proto-banner', '.nav', '#main', '.footer']
        .map((s) => document.querySelector<HTMLElement>(s))
        .filter((el): el is HTMLElement => !!el)
        .map((el) => {
          const b = el.getBoundingClientRect()
          el.style.willChange = 'transform'
          return { el, left: b.left, top: b.top }
        })
      root.classList.add('holding')
      window.getSelection()?.removeAllRanges()
      size()
      canvas.style.display = 'block'
      ro.style.display = 'block'
      sound.holdStart()
      gsap.ticker.add(frame)
    }

    const release = () => {
      if (phase === 'armed') {
        window.clearTimeout(armTimer)
        phase = 'idle'
        root.classList.remove('hold-armed')
        return
      }
      if (phase !== 'hold') return
      phase = 'release'
      relT = performance.now()
      relLevel = holdState.level
      holdState.holding = false
      holdState.blastAt = relT
      holdState.blastLevel = relLevel
      root.classList.remove('hold-armed')
      if (relLevel >= 0.12) sound.holdRelease(relLevel)
      else sound.holdCancel()
      if (relLevel > 0.5) markHoldSeen()
      suppressClick = (relT - startT) > 250
      geo?.shards.forEach((s) => (s.kRel = shardK(s, relLevel)))
    }

    const shardK = (s: Shard, level: number) => clamp01((level - s.th) / (1 - s.th))

    // DOM pose for a charge level (pointer-dependent tilt)
    const pose = (level: number, x: number, y: number) => {
      const side = x < W / 2 ? 1 : -1
      return {
        rz: -3.6 * level * side,
        rx: 7 * level * (y / H - 0.5),
        ry: -9 * level * (x / W - 0.5),
        s: 0.085 * level,
        tx: (W / 2 - ox) * 0.03 * level,
        ty: (H / 2 - oy) * 0.03 * level,
      }
    }

    const frame = () => {
      const now = performance.now()
      ctx.clearRect(0, 0, W, H)
      const x = holdState.x, y = holdState.y
      const g = geo
      if (!g) return
      if (phase === 'hold') {
        const raw = clamp01((now - startT) / 1000 / HOLD_FULL)
        const level = 1 - Math.pow(1 - raw, 1.6)
        holdState.level = level
        const p = pose(level, x, y)
        const tt = now / 1000
        const a = 2.6 * level * level + (level > 0.85 ? 1.6 * (level - 0.85) / 0.15 : 0)
        const jx = a * (Math.sin(tt * 47.3) * 0.6 + Math.sin(tt * 91.7 + 1.3) * 0.4)
        const jy = a * (Math.sin(tt * 53.1 + 2.1) * 0.6 + Math.sin(tt * 83.9) * 0.4)
        applyDom(p.rz, p.rx, p.ry, p.s, p.tx + jx, p.ty + jy)
        rel = p
        setCa(4.5 * level)
        drawHold(g, level, x, y, tt, now)
        if (depth.current) depth.current.textContent = String(Math.round(level * 100)).padStart(3, '0')
        ro.style.transform = `translate3d(${(x - 70 - 46 * level).toFixed(1)}px, ${(y + 56 + 40 * level).toFixed(1)}px, 0) translateX(-100%)`
        ro.style.opacity = String(clamp01(level * 4))
        return
      }
      if (phase === 'release') {
        const u = clamp01((now - relT) / BLAST_MS)
        const ts = (now - relT) / 1000
        const L = relLevel
        holdState.level = L * (1 - easeOut(clamp01(u * 3)))
        // Spring back with overshoot, plus a decaying kick.
        const k = Math.exp(-4.2 * ts) * Math.cos(13 * ts)
        const kick = 9 * L * Math.exp(-9 * ts)
        const kx = kick * Math.sin(ts * 70), ky = kick * Math.cos(ts * 61)
        applyDom(rel.rz * k, rel.rx * k, rel.ry * k, rel.s * k + 0.035 * L * Math.exp(-7 * ts) * Math.sin(ts * 22), rel.tx * k + kx, rel.ty * k + ky)
        setCa(4.5 * L * Math.max(0, k) + 6 * L * Math.exp(-10 * ts))
        drawRelease(g, L, ox, oy, u, ts)
        ro.style.opacity = String(clamp01(1 - u * 4))
        if (u >= 1) {
          ctx.clearRect(0, 0, W, H)
          canvas.style.display = 'none'
          ro.style.display = 'none'
          clearDom()
          holdState.level = 0
          phase = 'idle'
          gsap.ticker.remove(frame)
        }
      }
    }

    const drawHold = (g: Geo, level: number, x: number, y: number, tt: number, now: number) => {
      // Vignette pulling focus to the pointer
      const vg = ctx.createRadialGradient(x, y, 80, x, y, Math.max(W, H) * 0.9)
      vg.addColorStop(0, 'rgba(2,4,6,0)')
      vg.addColorStop(1, `rgba(2,4,6,${(0.62 * level).toFixed(3)})`)
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, W, H)
      // Warp streaks rushing outward
      const maxR = Math.hypot(W, H)
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgba(216,255,248,${(0.3 * level).toFixed(3)})`
      ctx.beginPath()
      for (const [a, ph, sp] of g.streaks) {
        const d = (tt * sp * (0.4 + level) + ph) % 1
        const r0 = 70 + d * d * maxR * 0.7
        const len = 10 + 190 * level * d
        const c = Math.cos(a), s = Math.sin(a)
        ctx.moveTo(x + c * r0, y + s * r0)
        ctx.lineTo(x + c * (r0 + len), y + s * (r0 + len))
      }
      ctx.stroke()
      drawGrid(g, level, x, y, now, 0)
      drawCracks(g, level, 1)
      drawShards(g, level, 1, 0, 0)
      // Scanning lens
      const R = 46 + 46 * level
      ctx.lineWidth = 1.2
      ctx.strokeStyle = `rgba(124,232,216,${(0.25 + 0.6 * clamp01(level * 3)).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, y, R, 0, TAU)
      ctx.stroke()
      ctx.beginPath()
      const rot = tt * 0.9
      for (let i = 0; i < 4; i++) {
        const a = rot + (i * TAU) / 4
        ctx.moveTo(x + Math.cos(a) * (R - 9), y + Math.sin(a) * (R - 9))
        ctx.lineTo(x + Math.cos(a) * (R + 9), y + Math.sin(a) * (R + 9))
      }
      ctx.moveTo(x - 7, y)
      ctx.lineTo(x + 7, y)
      ctx.moveTo(x, y - 7)
      ctx.lineTo(x, y + 7)
      ctx.stroke()
      // sweep wedge
      ctx.fillStyle = `rgba(124,232,216,${(0.1 * level).toFixed(3)})`
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.arc(x, y, R, tt * 3.2, tt * 3.2 + 0.7)
      ctx.closePath()
      ctx.fill()
      // Arc at full charge
      if (level > 0.82) {
        if (now - boltAt > 70) {
          boltAt = now
          boltPts = [x + Math.cos(r() * TAU) * R, y + Math.sin(r() * TAU) * R]
          const a1 = r() * TAU
          bolt(boltPts[0], boltPts[1], x + Math.cos(a1) * R * 1.8, y + Math.sin(a1) * R * 1.8, 5, boltPts, r)
        }
        const fl = ((level - 0.82) / 0.18) * (0.55 + 0.45 * r())
        for (const [w, c] of [[5, `rgba(124,232,216,${(0.25 * fl).toFixed(3)})`], [1.4, `rgba(236,255,252,${(0.95 * fl).toFixed(3)})`]] as const) {
          ctx.lineWidth = w
          ctx.strokeStyle = c
          ctx.beginPath()
          ctx.moveTo(boltPts[0], boltPts[1])
          for (let i = 2; i < boltPts.length; i += 2) ctx.lineTo(boltPts[i], boltPts[i + 1])
          ctx.stroke()
        }
      }
    }

    const drawGrid = (g: Geo, level: number, x: number, y: number, now: number, flash: number) => {
      const R = 50 + 170 * level
      if (R < 8) return
      const x0 = Math.floor((x - R) / GRID) * GRID, y0 = Math.floor((y - R) / GRID) * GRID
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgba(124,232,216,${(0.16 * clamp01(level * 2)).toFixed(3)})`
      ctx.beginPath()
      for (let gx = x0; gx <= x + R; gx += GRID)
        for (let gy = y0; gy <= y + R; gy += GRID) {
          const dx = gx + GRID / 2 - x, dy = gy + GRID / 2 - y
          if (dx * dx + dy * dy < R * R) ctx.rect(gx + 0.5, gy + 0.5, GRID - 1, GRID - 1)
        }
      ctx.stroke()
      // NO2 hotspot cells flare
      const heat = clamp01((level - 0.18) / 0.6)
      for (const [hx, hy, ph] of g.hot) {
        const dx = hx - x, dy = hy - y
        if (dx * dx + dy * dy > R * R) continue
        const f = 0.55 + 0.45 * Math.sin(now / 90 + ph * 20)
        ctx.fillStyle = `rgba(255,138,61,${clamp01(heat * (0.25 + 0.5 * f) + flash).toFixed(3)})`
        ctx.fillRect(hx + 0.5, hy + 0.5, GRID - 1, GRID - 1)
        ctx.strokeStyle = `rgba(255,190,140,${clamp01(heat * 0.9 + flash).toFixed(3)})`
        ctx.strokeRect(hx + 0.5, hy + 0.5, GRID - 1, GRID - 1)
      }
    }

    const drawCracks = (g: Geo, level: number, keep: number) => {
      for (const [w, c] of [[3, 'rgba(124,232,216,0.22)'], [1, 'rgba(236,255,252,0.85)']] as const) {
        ctx.lineWidth = w
        ctx.strokeStyle = c
        ctx.beginPath()
        for (const cr of g.cracks) {
          const vis = Math.pow(clamp01((level - cr.d) / (1 - cr.d)), 0.8) * cr.total * keep
          if (vis <= 0) continue
          ctx.moveTo(cr.pts[0], cr.pts[1])
          for (let i = 1; i < cr.len.length; i++) {
            const px = cr.pts[i * 2 - 2], py = cr.pts[i * 2 - 1], qx = cr.pts[i * 2], qy = cr.pts[i * 2 + 1]
            if (cr.len[i] <= vis) ctx.lineTo(qx, qy)
            else {
              const f = (vis - cr.len[i - 1]) / (cr.len[i] - cr.len[i - 1])
              ctx.lineTo(px + (qx - px) * f, py + (qy - py) * f)
              break
            }
          }
        }
        ctx.stroke()
      }
    }

    // fade: overall alpha factor; back: 0..1 reassembly (release)
    const drawShards = (g: Geo, level: number, fade: number, back: number, ca: number) => {
      const split = 1.5 + 4 * level + ca
      for (const s of g.shards) {
        let k = back > 0 ? s.kRel * (1 - back) : clamp01((level - s.th) / (1 - s.th))
        if (k <= 0.001) continue
        k = Math.min(1, k)
        const dist = Math.pow(k, 1.35) * 280 * s.grow
        const cx = s.bx + s.vx * dist, cy = s.by + s.vy * dist
        const sc = 1 + k * s.grow
        const rot = s.spin * k
        const cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc
        const al = Math.min(1, k * 5) * (1 - 0.3 * k) * fade
        const path = (ox2: number) => {
          ctx.beginPath()
          for (let i = 0; i < s.verts.length; i += 2) {
            const vx = s.verts[i], vy = s.verts[i + 1]
            const px = cx + vx * cs - vy * sn + ox2, py = cy + vx * sn + vy * cs
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
        }
        // Glass: a pale translucent body, chromatic fringes, one bright lit edge.
        path(0)
        ctx.fillStyle = `rgba(150,230,220,${(0.13 * al).toFixed(3)})`
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = `rgba(255,90,60,${(0.4 * al).toFixed(3)})`
        path(split)
        ctx.stroke()
        ctx.strokeStyle = `rgba(124,232,216,${(0.45 * al).toFixed(3)})`
        path(-split)
        ctx.stroke()
        const ex = cx + s.verts[0] * cs - s.verts[1] * sn, ey = cy + s.verts[0] * sn + s.verts[1] * cs
        const fx = cx + s.verts[2] * cs - s.verts[3] * sn, fy = cy + s.verts[2] * sn + s.verts[3] * cs
        ctx.lineWidth = 1.6
        ctx.strokeStyle = `rgba(240,255,252,${(0.9 * al).toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(ex, ey)
        ctx.lineTo(fx, fy)
        ctx.stroke()
      }
    }

    const drawRelease = (g: Geo, L: number, x: number, y: number, u: number, ts: number) => {
      // Flash
      if (u < 0.14) {
        ctx.fillStyle = `rgba(216,255,248,${(0.3 * L * (1 - u / 0.14)).toFixed(3)})`
        ctx.fillRect(0, 0, W, H)
      }
      const back = easeOutBack(clamp01(u * 2.2))
      drawGrid(g, L * (1 - easeOut(clamp01(u * 2.5))), x, y, performance.now(), 0.6 * (1 - clamp01(u * 3)))
      drawCracks(g, L, 1 - easeOut(clamp01(u * 3.2)))
      drawShards(g, L, 1 - clamp01((u - 0.3) * 2.5), clamp01(back), 0)
      // Shockwave rings (chromatic)
      for (let i = 0; i < 3; i++) {
        const uu = u - i * 0.07
        if (uu <= 0) continue
        const rr = easeOut(clamp01(uu * 1.15)) * Math.hypot(W, H) * (0.75 + 0.15 * i)
        const a = Math.pow(1 - clamp01(uu * 1.15), 1.6) * (0.85 - i * 0.22) * (0.4 + 0.6 * L)
        if (a <= 0.01) continue
        const lw = 2 + 26 * (1 - uu) * (i === 0 ? 1 : 0.4)
        ctx.lineWidth = lw
        ctx.strokeStyle = `rgba(255,90,60,${(a * 0.45).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, rr + lw * 0.45, 0, TAU)
        ctx.stroke()
        ctx.strokeStyle = `rgba(124,232,216,${(a * 0.6).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, Math.max(0, rr - lw * 0.45), 0, TAU)
        ctx.stroke()
        ctx.lineWidth = Math.max(1, lw * 0.25)
        ctx.strokeStyle = `rgba(236,255,252,${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, y, rr, 0, TAU)
        ctx.stroke()
      }
      // Sparks
      const cols = ['rgba(255,138,61,', 'rgba(124,232,216,', 'rgba(236,255,252,']
      const fadeS = 1 - clamp01(u * 1.3)
      if (fadeS > 0) {
        for (let c = 0; c < 3; c++) {
          ctx.fillStyle = `${cols[c]}${(fadeS * (0.5 + 0.5 * L)).toFixed(3)})`
          ctx.beginPath()
          for (const s of g.sparks) {
            if (s.c !== c) continue
            const d = (s.v * (0.5 + 0.5 * L) * (1 - Math.exp(-3.2 * ts))) / 3.2
            const px = x + Math.cos(s.a) * (d + 30), py = y + Math.sin(s.a) * (d + 30) + 60 * ts * ts
            ctx.rect(px, py, s.s, s.s)
          }
          ctx.fill()
        }
      }
    }

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse' || phase !== 'idle') return
      const t = e.target as Element | null
      if (!t?.closest?.('[data-hold]') || t.closest(HOLD_EXCLUDE)) return
      phase = 'armed'
      root.classList.add('hold-armed')
      downX = holdState.x = e.clientX
      downY = holdState.y = e.clientY
      armTimer = window.setTimeout(() => {
        if (phase === 'armed') begin()
      }, 140)
    }
    const move = (e: PointerEvent) => {
      if (phase === 'idle') return
      holdState.x = e.clientX
      holdState.y = e.clientY
      if (phase === 'armed' && Math.hypot(e.clientX - downX, e.clientY - downY) > 8) {
        window.clearTimeout(armTimer)
        phase = 'idle'
        root.classList.remove('hold-armed')
      }
    }
    const up = () => release()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') release()
    }
    const click = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.preventDefault()
      e.stopPropagation()
    }
    const hide = () => {
      if (document.hidden) release()
    }
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', up)
    window.addEventListener('keydown', key)
    window.addEventListener('click', click, true)
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('resize', size)
    return () => {
      window.clearTimeout(armTimer)
      gsap.ticker.remove(frame)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', up)
      window.removeEventListener('keydown', key)
      window.removeEventListener('click', click, true)
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('resize', size)
      if (phase === 'hold') sound.holdCancel()
      clearDom()
      root.classList.remove('hold-armed')
      holdState.holding = false
      holdState.level = 0
    }
  }, [fine, reduced])

  if (!fine || reduced) return null
  return (
    <>
      <canvas ref={cv} className="holdfx" aria-hidden="true" />
      <div ref={readout} className="hold-readout" aria-hidden="true">
        <span className="hr-k">Scan depth</span> <span ref={depth}>000</span>%
        <span className="hr-sub">TROPOMI pixel 5.5 × 3.5 km</span>
      </div>
    </>
  )
}
