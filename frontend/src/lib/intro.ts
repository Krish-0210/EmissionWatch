// Once-per-session intro: plays on a first load that lands on Home (sessionStorage flag).
const KEY = 'pc-intro'
let decided: boolean | undefined

/** Stable until the intro has run (StrictMode calls initialisers twice). */
export function shouldPlayIntro(): boolean {
  if (decided !== undefined) return decided
  try {
    decided = !sessionStorage.getItem(KEY) && window.location.pathname === '/'
    sessionStorage.setItem(KEY, '1')
  } catch {
    decided = false
  }
  return decided
}

export function introFinished() {
  decided = false
}
