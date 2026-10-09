import { useSyncExternalStore } from 'react'
import { sound } from './sound'

/** The sound preference (on/off), re-rendering on toggle. */
export const useSoundOn = () =>
  useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.enabled,
    () => false,
  )
