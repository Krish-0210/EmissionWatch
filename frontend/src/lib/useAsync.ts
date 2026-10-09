import { useEffect, useState } from 'react'

export interface AsyncState<T> {
  data?: T
  error?: string
}

// Runs fn when deps change; results from stale calls are ignored. `peek` may return an already
// cached value so the first render has data.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], peek?: () => T | undefined): AsyncState<T> {
  const key = JSON.stringify(deps)
  const [state, setState] = useState<AsyncState<T> & { key?: string }>(() => {
    const data = peek?.()
    return data === undefined ? {} : { key, data }
  })
  const cached = state.key !== key ? peek?.() : undefined
  useEffect(() => {
    let live = true
    fn().then(
      (data) => live && setState({ key, data }),
      (e: unknown) => live && setState({ key, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state : cached !== undefined ? { data: cached } : {}
}
