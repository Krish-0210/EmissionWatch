import type { Confidence, RiskLevel } from '../api'
import { CONF_LABEL, RISK_COLOR, RISK_LABEL } from '../lib/format'

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`badge ${level}`}>
      <span className="dot" style={{ background: RISK_COLOR[level], color: RISK_COLOR[level] }} aria-hidden="true" />
      {RISK_LABEL[level]}
    </span>
  )
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <span className="badge conf">{CONF_LABEL[confidence]}</span>
}
