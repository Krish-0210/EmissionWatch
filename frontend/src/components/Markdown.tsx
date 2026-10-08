import type { ReactNode } from 'react'

// Minimal Markdown for briefs: headings, bullet/numbered lists, paragraphs, **bold**.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  )
}

export default function Markdown({ source }: { source: string }) {
  const out: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length) out.push(<p key={out.length}>{inline(para.join(' '))}</p>)
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
    if (!line) {
      flushPara()
      flushList()
    } else if (h) {
      flushPara()
      flushList()
      out.push(<h3 key={out.length}>{inline(h[2])}</h3>)
    } else if (ul || ol) {
      flushPara()
      const ordered = !!ol
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((ul ?? ol)![1])
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return <div className="brief">{out}</div>
}
