// True when a hardware-accelerated WebGL context is available. Software renderers
// (SwiftShader, llvmpipe) report a major performance caveat; those get static posters.
let cached: boolean | undefined

export function webglOk(): boolean {
  if (cached !== undefined) return cached
  try {
    const c = document.createElement('canvas')
    const opts = { failIfMajorPerformanceCaveat: true }
    const gl = (c.getContext('webgl2', opts) || c.getContext('webgl', opts)) as WebGLRenderingContext | null
    cached = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cached = false
  }
  return cached
}
