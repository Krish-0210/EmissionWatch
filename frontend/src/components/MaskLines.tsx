import { useEffect, useState, type CSSProperties } from 'react'
import { useReducedMotion } from '../lib/motion'

// Pseudo-random 0..1 per character, stable across renders (reveal order).
const rnd = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Characters of a string as inline-block spans, grouped by word so lines still wrap between words.
function Chars({ text, line, offset = 0 }: { text: string; line: number; offset?: number }) {
  let k = offset
  return (
    <>
      {text.split(/(\s+)/).map((w, wi) =>
        /^\s+$/.test(w) ? (
          ' '
        ) : (
          <span key={wi} className="wd">
            {Array.from(w).map((c, ci) => {
              const i = k++
              return (
                <span key={ci} className="ch" style={{ '--r': rnd(line + 1, i).toFixed(3) } as CSSProperties}>
                  {c}
                </span>
              )
            })}
          </span>
        ),
      )}
    </>
  )
}

// The last word of a line that swaps every few seconds: its letters blur out in random order and
// the next word's letters blur in (off with reduced motion: the first word stays).
function RotWord({ words, line }: { words: string[]; line: number }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(0) // swaps so far
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (reduced || words.length < 2) return
    let t1 = 0
    const t0 = window.setInterval(() => {
      setOut(true)
      t1 = window.setTimeout(() => {
        setN((k) => k + 1)
        setOut(false)
      }, 620)
    }, 3800)
    return () => {
      window.clearInterval(t0)
      window.clearTimeout(t1)
    }
  }, [reduced, words.length])
  return (
    <span className={`rotw${out ? ' out' : ''}${n ? ' swap' : ''}`} key={n}>
      <Chars text={words[n % words.length]} line={line + n * 7} />
    </span>
  )
}

// Heading lines that reveal when an ancestor (or the element itself) gets .in (the reveal observer
// in Layout, or a page's own trigger).
//   fx="blur" (default): every character comes out of a blur, in random order, line by line.
//   fx="rise": each line rises from a clipping mask.
// Lines from `accentFrom` on take the accent colour. `rotate` makes the last word of a line cycle
// through `words` (the first is the one in the sentence). Screen readers get the plain sentence.
export default function MaskLines({
  lines,
  accentFrom = 1,
  tone = 'signal',
  delay = 0,
  step = 120,
  fx = 'blur',
  rotate,
}: {
  lines: string[]
  accentFrom?: number
  tone?: 'signal' | 'ember'
  delay?: number // ms before the first line
  step?: number // ms between lines
  fx?: 'blur' | 'rise'
  rotate?: { line: number; words: string[] }
}) {
  return (
    <span className={`mlines fx-${fx}`} style={{ '--md': `${delay}ms`, '--ms': `${step}ms` } as CSSProperties}>
      <span className="sr-only">{lines.join(' ')}</span>
      <span aria-hidden="true">
        {lines.map((l, i) => {
          const rot = rotate && rotate.line === i && fx === 'blur' ? rotate.words : null
          const head = rot ? l.slice(0, l.length - rot[0].length) : l
          return (
            <span key={i} className={`ml${i >= accentFrom ? ` acc ${tone}` : ''}`} style={{ '--l': i } as CSSProperties}>
              <span>
                {fx === 'blur' ? <Chars text={head} line={i} /> : l}
                {rot && <RotWord words={rot} line={i} />}
              </span>
            </span>
          )
        })}
      </span>
    </span>
  )
}
