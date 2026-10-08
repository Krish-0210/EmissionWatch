import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // three.js + R3F is one lazily loaded chunk (~240 kB gzip), only fetched for 3D scenes.
  build: { chunkSizeWarningLimit: 1000 },
})
