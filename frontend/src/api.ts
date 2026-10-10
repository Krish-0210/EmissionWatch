// Data contract between the pipeline export (pipeline/src/export/to_json.py) and the map app.
// Static JSON from public/data/, or the API when VITE_API_URL is set. Units: generation in MU (GWh); NO2 in µmol/m²
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

export interface BacktestRow {
  cluster: string // cluster id, or 'POOLED'
  gen_2019: number // MU/day, mean over valid days of Apr 1 – May 31
  gen_2020: number
  days_2019: number
  days_2020: number
  observed_2019: number // µmol/m²
  observed_2020: number
  predicted_2020: number
  gen_change_pct: number
  observed_change_pct: number
  predicted_change_pct: number
  error: number // predicted − observed, µmol/m²
}

export interface SummaryFile {
  generated_at: string
  units: { coef: string; backtest: string }
  pooled_model: { enhancement: ModelStats; ratio: ModelStats }
  clusters: { id: string; generation_coef: number; p: number }[]
  backtest: BacktestRow[]
  findings: string[]
}

// All coal plants >= 500 MW (GEM, operating units) with their state; plants_india.json / GET /plants.
export interface IndiaPlant {
  id: string // slug of the GEM plant name; not the registry id used in ClusterDetail.plants
  name: string
  lat: number
  lon: number
  capacity_mw: number // operating capacity, >= 500
  state: string // equals StateSummary.name
  status: 'operating'
  cluster_id: string | null // one of the analysed clusters (links to /cluster/:id), else null
}

export interface PlantsIndiaFile {
  boundaries: string // attribution for the state boundaries
  plants: IndiaPlant[] // largest capacity first
}

// states.json / GET /states: 36 states and union territories, sorted by name.
export interface StateSummary {
  code: string // e.g. "IN-CT"
  name: string
  lat: number // centroid of the unit's largest polygon
  lon: number
  plant_count: number // 0 = no coal plant of 500 MW or more listed
  total_capacity_mw: number
  plant_ids: string[] // IndiaPlant.id, largest capacity first
}

export interface StatesFile {
  boundaries: string
  states: StateSummary[]
}

export interface Brief {
  markdown: string
  source: 'bedrock' | 'template' | 'auto' // AI-written (Bedrock) or the deterministic fallback ('template'; 'auto' is treated the same)
}

// VITE_API_URL unset: static files from public/data/. Set: the deployed API, same shapes.
//   GET  {API}/clusters                  -> ClustersFile
//   GET  {API}/clusters/{id}             -> ClusterDetail
//   GET  {API}/clusters/{id}/timeseries  -> TimeseriesFile
//   GET  {API}/summary                   -> SummaryFile
//   POST {API}/brief/{id}                -> Brief {markdown, source}
//   GET  {API}/plants                    -> PlantsIndiaFile   (static: plants_india.json)
//   GET  {API}/states                    -> StatesFile        (static: states.json)
const rawApi = import.meta.env.VITE_API_URL as string | undefined
export const API_URL = rawApi ? rawApi.replace(/\/$/, '') : undefined
export const briefAvailable = API_URL !== undefined

const staticBase = `${import.meta.env.BASE_URL}data/`
const url = (apiPath: string, file: string) => (API_URL ? API_URL + apiPath : staticBase + file)

// In-memory cache: one request per URL per page load; failed requests are retried next time.
// `peek` returns a value synchronously once it has arrived (lets pages render on the first frame,
// which view transitions need).
const pending = new Map<string, Promise<unknown>>()
const settled = new Map<string, unknown>()

function getJson<T>(href: string): Promise<T> {
  let p = pending.get(href)
  if (!p) {
    p = fetch(href).then(async (res) => {
      if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`)
      const v = await res.json()
      settled.set(href, v)
      return v
    })
    p.catch(() => pending.delete(href))
    pending.set(href, p)
  }
  return p as Promise<T>
}
const peek = <T>(href: string) => settled.get(href) as T | undefined

export const fetchClusters = () => getJson<ClustersFile>(url('/clusters', 'clusters.json'))
export const fetchCluster = (id: string) => getJson<ClusterDetail>(url(`/clusters/${id}`, `cluster_${id}.json`))
export const fetchTimeseries = (id: string) =>
  getJson<TimeseriesFile>(url(`/clusters/${id}/timeseries`, `timeseries_${id}.json`))
export const fetchSummary = () => getJson<SummaryFile>(url('/summary', 'summary.json'))
export const fetchPlantsIndia = () => getJson<PlantsIndiaFile>(url('/plants', 'plants_india.json'))
export const fetchStates = () => getJson<StatesFile>(url('/states', 'states.json'))

export const peekClusters = () => peek<ClustersFile>(url('/clusters', 'clusters.json'))
export const peekCluster = (id: string) => peek<ClusterDetail>(url(`/clusters/${id}`, `cluster_${id}.json`))
export const peekTimeseries = (id: string) => peek<TimeseriesFile>(url(`/clusters/${id}/timeseries`, `timeseries_${id}.json`))
export const peekSummary = () => peek<SummaryFile>(url('/summary', 'summary.json'))

export async function generateBrief(id: string): Promise<Brief> {
  if (!API_URL) throw new Error('Brief generation available in deployed version')
  const res = await fetch(`${API_URL}/brief/${id}`, { method: 'POST' })
  if (!res.ok) throw new Error(`Brief request failed: HTTP ${res.status}`)
  return res.json() as Promise<Brief>
}
