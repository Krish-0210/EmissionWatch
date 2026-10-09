// Section monogram: an outlined display numeral with the mono micro-label beside it.
export default function SectionHead({ n, label, tone = 'signal' }: { n: string; label: string; tone?: 'signal' | 'ember' }) {
  return (
    <div className={`sec-head reveal ${tone}`}>
      <span className="sec-num" aria-hidden="true">
        {n}
      </span>
      <span className={`micro ${tone}`}>{label}</span>
    </div>
  )
}
