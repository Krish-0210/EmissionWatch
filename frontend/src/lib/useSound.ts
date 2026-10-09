import { useSyncExternalStore } from 'react'
import { sound } from './sound'

/** The sound preference (on/off), re-rendering on toggle. */
export const useSoundOn = () =>
  useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.enabled,
    () => false,
  )

/** Whether a gesture has unlocked audio yet (the intro's hint reads this). */
export const useSoundStarted = () =>
  useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.started,
    () => false,
  )
