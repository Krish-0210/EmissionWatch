// PanoptiCoal mark: an eye whose iris is concentric orbit rings, with a satellite on the outer ring.
// `animated` turns the rings and the satellite (CSS, off with reduced motion). Same drawing as public/favicon.svg.
export function LogoMark({ size = 28, animated = false, className = '' }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`logo-mark${animated ? ' spin' : ''} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* Lids */}
      <path d="M3 24 C 11 11.5, 37 11.5, 45 24 C 37 36.5, 11 36.5, 3 24 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {/* Iris: orbit rings */}
      <g className="lm-orbit">
        <circle cx="24" cy="24" r="10.5" fill="none" stroke="var(--signal)" strokeWidth="1.3" strokeDasharray="46 4 6 4" />
        <circle cx="34.5" cy="24" r="2.2" fill="var(--signal)" />
      </g>
      <circle className="lm-iris" cx="24" cy="24" r="7" fill="none" stroke="var(--signal)" strokeOpacity="0.55" strokeWidth="1.1" strokeDasharray="3 2.2" />
      {/* Pupil: the coal plant's ember */}
      <circle cx="24" cy="24" r="3.6" fill="var(--ember)" />
    </svg>
  )
}

export function Wordmark({ mark = true, animated = false }: { mark?: boolean; animated?: boolean }) {
  return (
    <span className="wordmark">
      {mark && <LogoMark animated={animated} />}
      <span className="wm-text">
        Panopti<span className="wm-coal">Coal</span>
      </span>
    </span>
  )
}
