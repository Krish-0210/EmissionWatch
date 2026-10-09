// The hero globe's starting view, without three.js (the intro and the poster load before the 3D
// chunk). Conventions match three/geo.ts and GlobeScene: rotation (pitch, yaw, 0, 'XYZ') applied to
// model points, camera on +Z looking at the origin.

import { heroDist, heroOffset } from '../three/layout'

const rad = (d: number) => (d * Math.PI) / 180

/** Unit vector for lat/lon, as three/geo.ts latLonToVec3. */
export function vec(lat: number, lon: number): [number, number, number] {
  const phi = rad(lon + 180), th = rad(90 - lat)
  return [-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)]
}

/** lat/lon (degrees) of a model-space unit vector (inverse of vec). */
export function latLon(x: number, y: number, z: number): [number, number] {
  const lat = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI
  const lon = ((((Math.atan2(z, -x) * 180) / Math.PI - 180 + 540) % 360) + 360) % 360 - 180
  return [lat, lon]
}

export const INDIA = { lat: 22.5, lon: 81.5 }

// Euler that turns India to face +Z (three/geo.ts faceRotation).
export const INDIA_FACE = (() => {
  const [x, y, z] = vec(INDIA.lat, INDIA.lon)
  const yaw = Math.atan2(-x, z)
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw)
  return { yaw, pitch: Math.atan2(y, z1) }
})()

/** GlobeScene's starting orientation: India's facing yaw − 0.9, pitch × 0.6. */
export const HERO_VIEW = { yaw: INDIA_FACE.yaw - 0.9, pitch: INDIA_FACE.pitch * 0.6 }

/** Model -> view: yaw about Y, then pitch about X. */
export function toView(x: number, y: number, z: number, yaw: number, pitch: number): [number, number, number] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp]
}

/** View -> model (inverse of toView). */
export function toModel(x: number, y: number, z: number, yaw: number, pitch: number): [number, number, number] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const y1 = y * cp + z * sp, z1 = -y * sp + z * cp
  return [x * cy - z1 * sy, y1, x * sy + z1 * cy]
}

// The 3D globe sits off the camera axis (heroOffset), so perspective shows it turned toward the
// camera by atan(offset / distance). The 2D views (intro dots, poster) apply the same turn after
// the globe's own rotation.
export function lookFix(narrow: boolean) {
  const d = heroDist(narrow)
  const o = heroOffset(narrow)
  return { yaw: Math.atan2(o.x, d), pitch: Math.atan2(-o.y, d) }
}

/** Model -> what the hero camera sees: globe rotation, then the off-axis turn. */
export function heroView(x: number, y: number, z: number, yaw: number, pitch: number, fix: { yaw: number; pitch: number }) {
  const v = toView(x, y, z, yaw, pitch)
  return toView(v[0], v[1], v[2], fix.yaw, fix.pitch)
}

/** Inverse of heroView. */
export function heroModel(x: number, y: number, z: number, yaw: number, pitch: number, fix: { yaw: number; pitch: number }) {
  const v = toModel(x, y, z, fix.yaw, fix.pitch)
  return toModel(v[0], v[1], v[2], yaw, pitch)
}
