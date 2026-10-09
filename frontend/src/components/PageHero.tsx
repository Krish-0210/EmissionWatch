import { memo, type CSSProperties, type ReactNode } from 'react'
import BigWord from './BigWord'
import MaskLines from './MaskLines'

// Title that rises word by word when its .reveal parent comes into view.
export function Words({ text, dim, delay = 0 }: { text: string; dim?: string; delay?: number }) {
  let n = 0
  const split = (s: string) =>
    s.split(' ').map((w, i) => (
      <span key={i} className="w" style={{ '--w': n++ } as CSSProperties}>
        {w}
        {' '}
      </span>
    ))
  return (
    <span className="words" style={{ '--d': `${delay}ms` } as CSSProperties}>
      <span className="sr-only">{dim ? `${text} ${dim}` : text}</span>
      <span aria-hidden="true">
        {split(text)}
        {dim && <span className="dim">{split(dim)}</span>}
      </span>
    </span>
  )
}

export interface TickerItem {
  label: string
  value?: string
  color?: string
}

// Marquee of real stats; pauses on hover, wraps statically with reduced motion.
export const Ticker = memo(function Ticker({ items, seconds = 48 }: { items: TickerItem[]; seconds?: number }) {
  if (!items.length) return null
  const row = (dup: boolean) =>
    items.map((it, i) => (
      <span className="ticker-item" key={`${dup ? 'b' : 'a'}${i}`} aria-hidden={dup || undefined} style={it.color ? ({ '--c': it.color } as CSSProperties) : undefined}>
        <i />
        {it.label}
        {it.value && <b>{it.value}</b>}
      </span>
    ))
  return (
    <div className="ticker" role="marquee" aria-label="Key figures">
      <div className="ticker-track" style={{ '--dur': `${seconds}s` } as CSSProperties}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  )
})

export function Divider() {
  return <div className="divider" aria-hidden="true" />
}

interface Props {
  eyebrow: ReactNode
  title: string
  dim?: string
  lede?: ReactNode
  word: string
  visual: ReactNode
  ticker?: TickerItem[]
  children?: ReactNode // actions under the lede
  titleClass?: string
}

// Page-specific animated banner: text left, live visual right, giant faded word behind, stats ticker below.
export default function PageHero({ eyebrow, title, dim, lede, word, visual, ticker, children, titleClass = 'd-lg' }: Props) {
  return (
    <header className="phero" data-hold>
      <BigWord speed={0.1}>{word}</BigWord>
      <div className="container layer phero-grid">
        <div className="trig">
          <div className="micro signal phero-eyebrow">{eyebrow}</div>
          <h1 className={`display ${titleClass}`}>
            <MaskLines lines={dim ? [title, dim] : [title]} delay={120} step={140} />
            <span className="scanline" aria-hidden="true" />
          </h1>
          {lede && (
            <div className="lede reveal" style={{ '--d': '420ms' } as CSSProperties}>
              {lede}
            </div>
          )}
          {children && (
            <div className="phero-actions reveal" style={{ '--d': '560ms' } as CSSProperties}>
              {children}
            </div>
          )}
        </div>
        <div className="phero-visual reveal clip-reveal" data-parallax="0.06" style={{ '--d': '200ms' } as CSSProperties}>
          {visual}
        </div>
      </div>
      {ticker && <Ticker items={ticker} />}
    </header>
  )
}
