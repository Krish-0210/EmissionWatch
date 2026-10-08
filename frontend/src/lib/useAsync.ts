import { useEffect, useState } from 'react'

export interface AsyncState<T> {
  data?: T
  error?: string
}

// Runs fn when deps change; results from stale calls are ignored.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const key = JSON.stringify(deps)
  const [state, setState] = useState<AsyncState<T> & { key?: string }>({})
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
  return state.key === key ? state : {}
}
