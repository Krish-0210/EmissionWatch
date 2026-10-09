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
