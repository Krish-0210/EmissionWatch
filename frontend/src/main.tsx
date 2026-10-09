// Type system (CLAUDE.md "Typography"): Familjen Grotesk display, Inter Tight body, Martian Mono buttons/UI,
// JetBrains Mono data labels, Unbounded 700 for the wordmark only. All OFL, self-hosted.
import '@fontsource/familjen-grotesk/latin-400.css'
import '@fontsource/familjen-grotesk/latin-500.css'
import '@fontsource/inter-tight/latin-400.css'
import '@fontsource/inter-tight/latin-500.css'
import '@fontsource/martian-mono/latin-300.css'
import '@fontsource/martian-mono/latin-400.css'
import '@fontsource/unbounded/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/system.css'
import './styles/fx.css'
import App from './App.tsx'

// Dev-only FPS / frame-time readout; tree-shaken from production builds.
if (import.meta.env.DEV) void import('./dev/fpsMeter')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
