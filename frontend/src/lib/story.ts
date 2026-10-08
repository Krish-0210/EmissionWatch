export const STEPS = [
  { id: '01', label: 'The claim' },
  { id: '02', label: 'The observation' },
  { id: '03', label: 'The comparison' },
  { id: '04', label: 'The score' },
]

// Scroll positions (0..1 of the home stage) where each step starts.
export const STEP_AT = [0.14, 0.36, 0.6, 0.8]

export function stepFor(p: number) {
  let s = -1
  STEP_AT.forEach((a, i) => {
    if (p >= a) s = i
  })
  return s
}
