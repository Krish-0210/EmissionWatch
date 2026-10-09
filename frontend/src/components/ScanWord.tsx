import { useEffect, useRef } from 'react'
import { gsap } from '../lib/gsap'
import { prefersReducedMotion } from '../lib/motion'
import { sound } from '../lib/sound'

// Footer wordmark drawn as satellite scan lines: the word is rasterised into a mask, then each of
// ~24 horizontal rows is drawn only where it crosses the letters. Moving the pointer across a row
// "plucks" it: the row lights up, ripples around the pointer and plays a note (lib/sound pluck,
// minor pentatonic, higher rows higher). Canvas 2D; animates only while a row is still ringing.
const ROWS = 24

export default function ScanWord({ text }: { text: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = wrap.current, canvas = cv.current
    if (!host || !canvas) return
    const ctx = canvas.getContext('2d')!
    const reduced = prefersReducedMotion()
    let W = 0, H = 0, dpr = 1
    let segs: number[][] = [] // per row: [x0, x1, x0, x1, ...]
    let rowY: number[] = []
    const energy = new Float32Array(ROWS)
    let px = -1e3, lastRow = -1
    let running = false
    let alive = true

    const build = async () => {
      try {
        await document.fonts.load('400 120px "Familjen Grotesk"')
      } catch {
        /* fall back to whatever is loaded */
      }
      if (!alive) return
      W = host.clientWidth
      H = Math.round(W * 0.2)
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Mask at 1x
      const m = document.createElement('canvas')
      m.width = W
      m.height = H
      const mc = m.getContext('2d', { willReadFrequently: true })!
      let fs = H * 1.1
      mc.font = `400 ${fs}px "Familjen Grotesk", Arial, sans-serif`
      const ls = -0.065 * fs
      if ('letterSpacing' in mc) (mc as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`
      const w0 = mc.measureText(text.toUpperCase()).width
      fs *= (W * 0.98) / w0
      mc.font = `400 ${fs}px "Familjen Grotesk", Arial, sans-serif`
      if ('letterSpacing' in mc) (mc as unknown as { letterSpacing: string }).letterSpacing = `${-0.065 * fs}px`
      mc.textBaseline = 'alphabetic'
      mc.fillStyle = '#fff'
      const tm = mc.measureText(text.toUpperCase())
      const capTop = tm.actualBoundingBoxAscent
      const base = Math.round((H + capTop) / 2)
      mc.fillText(text.toUpperCase(), (W - tm.width) / 2, base)
      const d = mc.getImageData(0, 0, W, H).data
      const top = base - capTop, bot = base
      rowY = []
      segs = []
      for (let r = 0; r < ROWS; r++) {
        const y = Math.round(top + ((r + 0.5) / ROWS) * (bot - top))
        rowY.push(y)
        const s: number[] = []
        let on = false
        for (let x = 0; x < W; x++) {
          const a = d[(y * W + x) * 4 + 3] > 100
          if (a && !on) {
            s.push(x)
            on = true
          } else if (!a && on) {
            s.push(x)
            on = false
          }
        }
        if (on) s.push(W)
        segs.push(s)
      }
      draw(performance.now())
    }

    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H)
      const t = now / 1000
      let any = false
      for (let r = 0; r < ROWS; r++) {
        const e = energy[r]
        const y = rowY[r]
        const s = segs[r]
        if (!s || !s.length) continue
        if (e > 0.01) any = true
        ctx.lineWidth = 1.4 + e * 1.4
        ctx.strokeStyle = e > 0.02 ? `rgba(${Math.round(138 + (124 - 138) * e)},${Math.round(150 + (232 - 150) * e)},${Math.round(163 + (216 - 163) * e)},${(0.38 + 0.6 * e).toFixed(3)})` : 'rgba(138,150,163,0.38)'
        ctx.beginPath()
        for (let k = 0; k < s.length; k += 2) {
          const x0 = s[k], x1 = s[k + 1]
          if (e <= 0.02 || reduced) {
            ctx.moveTo(x0, y)
            ctx.lineTo(x1, y)
            continue
          }
          // ripple around the pointer x
          for (let x = x0; x <= x1; x += 4) {
            const g = Math.exp(-((x - px) * (x - px)) / 9000)
            const yy = y + e * 6 * g * Math.sin(x * 0.09 - t * 26)
            if (x === x0) ctx.moveTo(x, yy)
            else ctx.lineTo(x, yy)
          }
          ctx.lineTo(x1, y)
        }
        ctx.stroke()
        energy[r] = e * 0.93
      }
      return any
    }

    const loop = (_t: number) => {
      const any = draw(performance.now())
      if (!any) {
        running = false
        gsap.ticker.remove(loop)
      }
    }
    const kick = () => {
      if (!running) {
        running = true
        gsap.ticker.add(loop)
      }
    }
    const rowAt = (y: number) => {
      let best = -1, bd = 1e9
      for (let r = 0; r < rowY.length; r++) {
        const dd = Math.abs(rowY[r] - y)
        if (dd < bd) {
          bd = dd
          best = r
        }
      }
      return bd < (rowY[1] - rowY[0] || 8) ? best : -1
    }
    const move = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect()
      const x = e.clientX - b.left, y = e.clientY - b.top
      const r = rowAt(y)
      // every row crossed since the last event rings (fast sweeps play runs of notes)
      if (r >= 0 && lastRow >= 0 && r !== lastRow) {
        const step = r > lastRow ? 1 : -1
        for (let k = lastRow + step; k !== r + step; k += step) {
          const onLetter = segs[k]?.some((_, j) => j % 2 === 0 && x >= segs[k][j] - 6 && x <= segs[k][j + 1] + 6)
          energy[k] = 1
          if (onLetter) sound.pluck(k, ROWS)
        }
      } else if (r >= 0) energy[r] = Math.max(energy[r], 0.35)
      lastRow = r
      px = x
      kick()
    }
    const leave = () => {
      lastRow = -1
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    const ro = new ResizeObserver(() => void build())
    ro.observe(host)
    return () => {
      alive = false
      ro.disconnect()
      gsap.ticker.remove(loop)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
    }
  }, [text])

  return (
    <div ref={wrap} className="scanword" role="img" aria-label={`${text}, drawn in scan lines`}>
      <canvas ref={cv} />
    </div>
  )
}
