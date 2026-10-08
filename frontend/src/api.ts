// Data contract between the pipeline export (pipeline/src/export/to_json.py) and the map app.
// Static JSON served from public/data/. Units: generation in MU (GWh); NO2 in µmol/m²
// (tropospheric column, 20 km ring minus 50–80 km background). null = no valid data.

export type RiskLevel = 'low' | 'medium' | 'high'
export type Confidence = 'high' | 'medium' | 'low'

export interface ClusterSummary {
  id: string
  name: string
  states: string[]
  lat: number
  lon: number
  capacity_mw: number // operating registry capacity
  n_plants: number
  risk_score: number // 0–100
  risk_level: RiskLevel
  confidence: Confidence
  headline: string
}

export interface ClustersFile {
  generated_at: string // ISO timestamp
  as_of: string // latest residual date, YYYY-MM-DD
  clusters: ClusterSummary[]
}

export interface Plant {
  id: string
  name: string
  state: string
  lat: number
  lon: number
  capacity_mw: number
  status: 'operating' | 'retired'
}

export interface ModelStats {
  coef: number // generation coefficient
  t: number // Newey-West t-stat
  p: number
  partial_r2: number
  r2: number
  n: number // days
}

export interface Signals {
  persistent_excess: { z: number; score: number } // 90-day rolling residual, standardised
  intensity_trend: {
    pct_per_year: number
    t: number
    score: number
    yearly: { year: number; coef: number; se: number; days: number }[]
  }
  peer_intensity: { ratio: number; score: number } // generation coefficient / median of clusters
}

export interface ClusterDetail extends ClusterSummary {
  as_of: string
  plants: Plant[]
  weights: { persistent_excess: number; intensity_trend: number; peer_intensity: number }
  signals: Signals
  model: { enhancement: ModelStats; ratio: ModelStats } // enhancement coef: µmol/m² per MU/day
  confidence_notes: string[]
  coverage: {
    recent_valid_days: number // valid NO2 days in the last 365
    ring_capacity_mw: number // GEM coal capacity inside the 20 km ring
    unreported_capacity_mw: number // of which not in CEA generation
    unreported_plants: string[]
  }
}

export interface MonthPoint {
  month: string // YYYY-MM
  generation_mu: number | null // monthly total
  expected_no2: number | null // mean model fit over valid days
  observed_no2: number | null // mean observed enhancement over the same days
  residual: number | null // observed − expected
  valid_fraction: number | null // monthly share of valid pixel-days in the 20 km ring
}

export interface TimeseriesFile {
  id: string
  months: MonthPoint[]
}

const base = `${import.meta.env.BASE_URL}data/`

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(base + file)
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchClusters = () => getJson<ClustersFile>('clusters.json')
export const fetchCluster = (id: string) => getJson<ClusterDetail>(`cluster_${id}.json`)
export const fetchTimeseries = (id: string) => getJson<TimeseriesFile>(`timeseries_${id}.json`)
