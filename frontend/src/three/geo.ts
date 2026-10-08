import * as THREE from 'three'

export const EARTH_KM = 6371
export const kmToUnits = (km: number) => km / EARTH_KM

// Same convention as THREE.SphereGeometry with phi = lon + 180°, theta = 90° − lat,
// so textured sphere segments line up with points placed by lat/lon.
export function latLonToVec3(lat: number, lon: number, r = 1, out = new THREE.Vector3()) {
  const phi = THREE.MathUtils.degToRad(lon + 180)
  const theta = THREE.MathUtils.degToRad(90 - lat)
  return out.set(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta))
}

// Euler (order XYZ: applied Y then X) that turns the point at lat/lon to face +Z.
export function faceRotation(lat: number, lon: number) {
  const v = latLonToVec3(lat, lon)
  const yaw = Math.atan2(-v.x, v.z)
  const z1 = -v.x * Math.sin(yaw) + v.z * Math.cos(yaw)
  const pitch = Math.atan2(v.y, z1)
  return { yaw, pitch }
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export interface LandMask {
  w: number
  h: number
  data: Uint8ClampedArray
}

export async function loadLandMask(url: string): Promise<LandMask> {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data }
}

// 0 = sea, 1 = land, 2 = India.
export function sampleMask(m: LandMask, lat: number, lon: number): number {
  const x = Math.min(m.w - 1, Math.max(0, Math.floor(((lon + 180) / 360) * m.w)))
  const y = Math.min(m.h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * m.h)))
  const i = (y * m.w + x) * 4
  if (m.data[i + 1] > 127) return 2
  return m.data[i] > 127 ? 1 : 0
}

// Dots: a Fibonacci sphere for the world plus a denser 0.5° grid over India.
export function buildDots(m: LandMask, n: number) {
  const pos: number[] = []
  const col: number[] = []
  const land = new THREE.Color('#5d6875')
  const india = new THREE.Color('#d6e2ec')
  const v = new THREE.Vector3()
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const lat = THREE.MathUtils.radToDeg(Math.asin(y))
    const lon = ((THREE.MathUtils.radToDeg(golden * i) % 360) + 540) % 360 - 180
    const k = sampleMask(m, lat, lon)
    if (k === 1) {
      latLonToVec3(lat, lon, 1, v)
      pos.push(v.x, v.y, v.z)
      col.push(land.r, land.g, land.b)
    }
  }
  for (let lat = 6.25; lat < 37; lat += 0.5) {
    for (let lon = 68.25; lon < 98; lon += 0.5) {
      if (sampleMask(m, lat, lon) === 2) {
        latLonToVec3(lat, lon, 1.0005, v)
        pos.push(v.x, v.y, v.z)
        col.push(india.r, india.g, india.b)
      }
    }
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col) }
}
