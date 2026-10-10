import { useSyncExternalStore } from 'react'
import { sound } from './sound'

/** Whether sound is really playing (preference on AND the audio context running), re-rendering on
 *  toggle and on context state changes. Switches show this, never the preference alone. */
export const useSoundOn = () =>
  useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.active,
    () => false,
  )

/** The stored preference (on = sound starts at the next click / key / touch). */
export const useSoundPref = () =>
  useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.enabled,
    () => false,
  )
