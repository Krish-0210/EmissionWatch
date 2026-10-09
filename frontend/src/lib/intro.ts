// Intro: plays on every fresh page load that lands on Home (for the demo), unless the URL has
// ?intro=0. Client-side navigation back to Home does not replay it; the footer's "Replay intro"
// link does (router state { replayIntro }).
let decided: boolean | undefined

/** Stable for the first Home mount of this page load (StrictMode calls initialisers twice). */
export function shouldPlayIntro(): boolean {
  if (decided !== undefined) return decided
  const q = new URLSearchParams(window.location.search)
  decided = window.location.pathname === '/' && q.get('intro') !== '0'
  return decided
}

export function introFinished() {
  decided = false
}

/** Hides the nav until the intro hands off (html.intro-hold, see styles/intro.css). */
export function holdNav(on: boolean) {
  document.documentElement.classList.toggle('intro-hold', on)
}
