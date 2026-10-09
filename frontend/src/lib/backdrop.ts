import { useEffect } from 'react'

export type BackdropVariant = 'home' | 'map' | 'cluster' | 'near' | 'how' | 'limits'

export const backdropFor = (path: string): BackdropVariant =>
  path === '/' ? 'home' : path.startsWith('/map') ? 'map' : path.startsWith('/cluster') ? 'cluster' : path.startsWith('/near') ? 'near' : path.startsWith('/how') ? 'how' : 'limits'

/** Tints the background glows from a page: a cluster's risk level, or Home's story step. Cleared on unmount. */
export function useBackdropTone(key: 'tone' | 'step', value: string | undefined) {
  useEffect(() => {
    const el = document.documentElement
    if (value == null) delete el.dataset[key]
    else el.dataset[key] = value
    return () => {
      delete el.dataset[key]
    }
  }, [key, value])
}
