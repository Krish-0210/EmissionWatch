import type { ReactNode } from 'react'

// Minimal Markdown for briefs and RTI drafts: headings (# and ## as h3, ### and deeper as h4),
// bullet/numbered lists, paragraphs, **bold**, _italic_, "> " notes, "---" rules, and lines ending
// in two spaces kept as line breaks (addresses).
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|(?<![\w])_[^_]+_(?![\w]))/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.length > 2 && part.startsWith('_') && part.endsWith('_') ? (
      <em key={i}>{part.slice(1, -1)}</em>
    ) : (
      part
    ),
  )
}

export default function Markdown({ source }: { source: string }) {
  const out: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: { text: string; br: boolean }[] = []
  const flushPara = () => {
    if (para.length)
      out.push(
        <p key={out.length}>
          {para.map((l, i) => (
            <span key={i}>
              {inline(l.text)}
              {i < para.length - 1 ? l.br ? <br /> : ' ' : null}
            </span>
          ))}
        </p>,
      )
    para = []
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map((t, i) => <li key={i}>{inline(t)}</li>)
      out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>)
    }
    list = null
  }
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const ul = /^[-*]\s+(.*)$/.exec(line)
    const ol = /^\d+[.)]\s+(.*)$/.exec(line)
    const quote = /^>\s?(.*)$/.exec(line)
    if (!line) {
      flushPara()
      flushList()
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushPara()
      flushList()
      out.push(<hr key={out.length} />)
    } else if (h) {
      flushPara()
      flushList()
      out.push(h[1].length <= 2 ? <h3 key={out.length}>{inline(h[2])}</h3> : <h4 key={out.length}>{inline(h[2])}</h4>)
    } else if (quote) {
      flushPara()
      flushList()
      out.push(
        <blockquote key={out.length}>
          <p>{inline(quote[1])}</p>
        </blockquote>,
      )
    } else if (ul || ol) {
      flushPara()
      const ordered = !!ol
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((ul ?? ol)![1])
    } else {
      flushList()
      para.push({ text: line, br: / {2}$/.test(raw.replace(/\r$/, '')) })
    }
  }
  flushPara()
  flushList()
  return <div className="brief">{out}</div>
}
