import type { Confidence, RiskLevel } from '../api'

export const RISK_COLOR: Record<RiskLevel, string> = {
  low: '#7ce8d8',
  medium: '#ffc24b',
  high: '#ff5a3c',
}

export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }
export const CONF_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

export const fmt = (x: number | null | undefined, digits = 1) =>
  x == null || !Number.isFinite(x) ? '–' : x.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })

export const fmtInt = (x: number) => Math.round(x).toLocaleString('en-IN')

export function fmtP(p: number): string {
  if (p < 0.001) return '< 0.001'
  return p.toFixed(3)
}

export const fmtPct = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(0)}%`

// Plain-language one-liner by risk level (Near Me: no statistics).
export function plainHeadline(name: string, level: RiskLevel): string {
  switch (level) {
    case 'high':
      return `Recently, satellites have seen more pollution around ${name} than its reported power output explains. This pattern is worth an official check.`
    case 'medium':
      return `Satellite readings around ${name} show some signs worth watching, but nothing strong enough to call a clear pattern.`
    default:
      return `Satellite readings around ${name} are in line with what its reported power output would produce.`
  }
}
