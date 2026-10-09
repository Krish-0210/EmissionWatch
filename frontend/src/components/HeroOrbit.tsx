import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { ClusterSummary } from '../api'
import { RISK_LABEL } from '../lib/format'
import { heroGlobeScreen } from '../three/layout'
import Icon, { type IconName } from './Icons'

// Hero accents around the globe: glass data chips on slots of a ring just outside its silhouette,
// chosen so they stay on screen and clear of the hero copy, each drifting gently on its own orbit;
// and a pulsing scan button below the globe that sends the satellite's beam to a random cluster.

export interface OrbitChip {
  label: string
  value: string
  icon: IconName
  lead?: boolean // value first ("11 clusters")
}

interface Props {
  chips: OrbitChip[]
  clusters?: ClusterSummary[]
  onScan: (index: number) => void // sends the satellite's beam to clusters[index]
  live: boolean // the 3D globe is showing (scan needs it)
  on: boolean // the hero has started entering; the chips follow once its headline has played
}

interface Slot {
  x: number
  y: number
}

// Slot angles (degrees, screen y down): preferred diagonals first, then every 10° around the ring.
const PREF = [...new Set([-118, -62, 118, 62, -150, 150, -90, 90, -30, 30, ...Array.from({ length: 36 }, (_, i) => i * 10 - 180)])]

const HeroOrbit = forwardRef<HTMLDivElement, Props>(function HeroOrbit({ chips, clusters, onScan, live, on }, ref) {
  const box = useRef<HTMLDivElement | null>(null)
  const chipEls = useRef<(HTMLDivElement | null)[]>([])
  const [slots, setSlots] = useState<(Slot | null)[]>([])
  const [scanAt, setScanAt] = useState<Slot>()
  const [said, setSaid] = useState('')
  const lastScan = useRef(-1)
  // Chips enter ~0.95 s after the hero (their own layers are created then, not in the hero's first frame).
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!on) return
    const id = setTimeout(() => setShown(true), 950)
    return () => {
      clearTimeout(id)
      setShown(false)
    }
  }, [on])

  const layout = useCallback(() => {
    const el = box.current
    if (!el) return
    const w = el.clientWidth, h = el.clientHeight
    const g = heroGlobeScreen(w, h)
    const host = el.getBoundingClientRect()
    // At scroll 0 the stage starts below the prototype banner: only this much of it is on screen.
    const vh = Math.min(h, window.innerHeight - Math.max(0, host.top))
    // Keep-out boxes: the hero copy (with padding), the nav band at the top, the scan button.
    const avoid = Array.from(document.querySelectorAll<HTMLElement>('.hero > :not(.scroll-cue)')).map((n) => {
      const r = n.getBoundingClientRect()
      return { l: r.left - host.left - 28, t: r.top - host.top - 18, r: r.right - host.left + 28, b: r.bottom - host.top + 18 }
    })
    const navBottom = (document.querySelector('.nav')?.getBoundingClientRect().bottom ?? 64) - host.top
    const scanY = Math.min(g.cy + g.r + 46, vh - (w < 768 ? 64 : 56))
    avoid.push({ l: g.cx - 64, t: scanY - 32, r: g.cx + 64, b: scanY + 56 }) // button + label
    const placed: { l: number; t: number; r: number; b: number }[] = []
    const used: number[] = []
    const hit = (a: { l: number; t: number; r: number; b: number }, b: { l: number; t: number; r: number; b: number }) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
    const out = chips.map((_, i) => {
      const c = chipEls.current[i]
      const cw = c?.offsetWidth ?? 180, ch = c?.offsetHeight ?? 40
      // Gap to the silhouette: clear of it first; if nothing fits, allow the chip onto the atmosphere rim.
      for (const gap of [22, 6, -12])
      for (const deg of PREF) {
        if (used.some((u) => Math.abs(((deg - u + 540) % 360) - 180) < 24)) continue
        const a = (deg * Math.PI) / 180
        const rr = g.r + gap + Math.abs(Math.cos(a)) * (cw / 2) + Math.abs(Math.sin(a)) * (ch / 2)
        const x = g.cx + Math.cos(a) * rr, y = g.cy + Math.sin(a) * rr
        const rect = { l: x - cw / 2, t: y - ch / 2, r: x + cw / 2, b: y + ch / 2 }
        if (rect.l < 16 || rect.r > w - 16 || rect.t < navBottom + 14 || rect.b > vh - 16) continue
        if (avoid.some((k) => hit(rect, k)) || placed.some((k) => hit(rect, { l: k.l - 12, t: k.t - 10, r: k.r + 12, b: k.b + 10 }))) continue
        placed.push(rect)
        used.push(deg)
        return { x, y }
      }
      return null
    })
    setSlots(out)
    setScanAt({ x: g.cx, y: scanY })
  }, [chips])

  useLayoutEffect(() => {
    layout()
  }, [layout, on])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => layout())
    ro.observe(el)
    document.fonts?.ready.then(layout)
    // The hero copy settles after its entrance; measure again then.
    const id = setTimeout(layout, 1400)
    return () => {
      ro.disconnect()
      clearTimeout(id)
    }
  }, [layout])

  const scan = () => {
    if (!clusters?.length) return
    let i = Math.floor(Math.random() * clusters.length)
    if (i === lastScan.current) i = (i + 1) % clusters.length
    lastScan.current = i
    onScan(i)
    const c = clusters[i]
    setSaid(`Scanning ${c.name}: ${RISK_LABEL[c.risk_level]}, audit risk ${Math.round(c.risk_score)} of 100.`)
  }

  return (
    <div
      ref={(n) => {
        box.current = n
        if (typeof ref === 'function') ref(n)
        else if (ref) ref.current = n
      }}
      className={`hero-orbit${on && shown ? ' in' : ''}`}
    >
      {chips.map((c, i) => {
        const s = slots[i]
        return (
          <div
            key={c.label}
            ref={(n) => {
              chipEls.current[i] = n
            }}
            className={`orbit-chip${s ? '' : ' off'}`}
            style={{ left: s?.x ?? -999, top: s?.y ?? -999, '--i': i, '--dur': `${9 + i * 1.7}s` } as CSSProperties}
          >
            <div className="orbit-chip-in">
              <span className="orbit-ic">
                <Icon name={c.icon} size={14} draw={false} />
              </span>
              {c.lead ? (
                <>
                  <b>{c.value}</b>
                  <span className="orbit-label">{c.label}</span>
                </>
              ) : (
                <>
                  <span className="orbit-label">{c.label}</span>
                  <i className="orbit-sep" aria-hidden="true" />
                  <b>{c.value}</b>
                </>
              )}
            </div>
          </div>
        )
      })}
      {scanAt && live && (
        <div className="scan-btn-wrap" style={{ left: scanAt.x, top: scanAt.y }}>
          <button type="button" className="scan-btn" onClick={scan} aria-label="Scan a random cluster with the satellite">
            <i className="scan-wave" />
            <i className="scan-wave b" />
            <span className="scan-core">
              <Icon name="scan" size={20} draw={false} />
            </span>
          </button>
          <span className="micro scan-label" aria-hidden="true">
            Scan a cluster
          </span>
        </div>
      )}
      <span className="sr-only" role="status">
        {said}
      </span>
    </div>
  )
})

export default HeroOrbit

