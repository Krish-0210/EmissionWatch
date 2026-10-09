import { useSyncExternalStore } from 'react'
import { sound } from '../lib/sound'

export const useSoundOn = () =>
  useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => sound.enabled,
    () => false,
  )

// Nav sound switch: animated equaliser bars when on, a crossed speaker when off. A real button
// (keyboard and screen-reader friendly); the choice is saved in localStorage by lib/sound.
export default function SoundToggle({ className = '' }: { className?: string }) {
  const on = useSoundOn()
  return (
    <button
      type="button"
      className={`sound-toggle ${on ? 'on' : 'off'} ${className}`}
      aria-pressed={on}
      aria-label={on ? 'Sound on. Turn sound off' : 'Sound off. Turn sound on'}
      title={on ? 'Sound on' : 'Sound off'}
      onClick={() => sound.toggle()}
    >
      <span className="st-eq" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <svg className="st-off" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 8h3l4-3.5v11L6 12H3z" />
        <path d="M13 7.5l5 5M18 7.5l-5 5" />
      </svg>
      <span className="st-label">{on ? 'Sound on' : 'Sound off'}</span>
    </button>
  )
}
