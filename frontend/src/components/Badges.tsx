import type { ClusterSummary, Confidence, RiskLevel } from '../api'
import { CONF_LABEL, RISK_COLOR, RISK_LABEL } from '../lib/format'

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`badge ${level}`}>
      <span className="dot" style={{ background: RISK_COLOR[level], color: RISK_COLOR[level] }} aria-hidden="true" />
      {RISK_LABEL[level]}
    </span>
  )
}

// The signal driving the score above neutral (plain-language label; 'none' looks neutral).
export function AnomalyTag({ c }: { c: Pick<ClusterSummary, 'primary_anomaly_type' | 'primary_anomaly_label'> }) {
  return (
    <span className={`atag ${c.primary_anomaly_type}`} title="Main signal behind the score">
      {c.primary_anomaly_label}
    </span>
  )
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <span className="badge conf">{CONF_LABEL[confidence]}</span>
}
