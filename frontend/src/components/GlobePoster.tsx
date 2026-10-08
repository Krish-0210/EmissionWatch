// Static stand-in for the 3D globe: shown while it loads, with reduced motion, or without WebGL.
export default function GlobePoster({ className = '' }: { className?: string }) {
  return (
    <div className={`poster globe-poster ${className}`} aria-hidden="true">
      <svg viewBox="0 0 400 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="gp-body" cx="45%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#111821" />
            <stop offset="100%" stopColor="#07090c" />
          </radialGradient>
          <radialGradient id="gp-ember" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff8a3d" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ff8a3d" stopOpacity="0" />
          </radialGradient>
          <pattern id="gp-dots" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="0.9" fill="#5d6875" />
          </pattern>
          <clipPath id="gp-clip">
            <circle cx="200" cy="200" r="150" />
          </clipPath>
        </defs>
        <circle cx="200" cy="200" r="158" fill="none" stroke="#7ce8d8" strokeOpacity="0.18" strokeWidth="6" />
        <circle cx="200" cy="200" r="150" fill="url(#gp-body)" />
        <g clipPath="url(#gp-clip)" opacity="0.7">
          <path d="M150 120 C190 105 235 112 262 140 C255 170 240 205 215 238 C200 258 190 262 180 240 C168 212 150 190 135 160 Z" fill="url(#gp-dots)" />
          <path d="M60 200 C80 170 110 160 120 190 C118 230 95 260 70 250 Z" fill="url(#gp-dots)" />
          <path d="M270 90 C310 95 340 130 345 170 C320 160 290 140 270 120 Z" fill="url(#gp-dots)" />
        </g>
        <circle cx="205" cy="175" r="28" fill="url(#gp-ember)" opacity="0.8" />
        <ellipse cx="200" cy="200" rx="190" ry="60" fill="none" stroke="#7ce8d8" strokeOpacity="0.25" transform="rotate(-28 200 200)" />
        <circle cx="200" cy="200" r="150" fill="none" stroke="#7ce8d8" strokeOpacity="0.35" />
      </svg>
    </div>
  )
}
