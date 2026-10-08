// Approximate geographic centres of Indian states and union territories (for "pick a state").
export const STATE_CENTRES: Record<string, [number, number]> = {
  'Andhra Pradesh': [15.9, 79.7],
  'Arunachal Pradesh': [28.2, 94.7],
  Assam: [26.2, 92.9],
  Bihar: [25.9, 85.8],
  Chhattisgarh: [21.3, 81.9],
  Delhi: [28.65, 77.2],
  Goa: [15.4, 74.0],
  Gujarat: [22.3, 71.2],
  Haryana: [29.1, 76.1],
  'Himachal Pradesh': [31.9, 77.2],
  'Jammu and Kashmir': [33.5, 75.0],
  Jharkhand: [23.6, 85.3],
  Karnataka: [15.0, 75.7],
  Kerala: [10.4, 76.4],
  Ladakh: [34.2, 77.6],
  'Madhya Pradesh': [23.5, 78.5],
  Maharashtra: [19.5, 75.7],
  Manipur: [24.7, 93.9],
  Meghalaya: [25.5, 91.3],
  Mizoram: [23.2, 92.9],
  Nagaland: [26.1, 94.5],
  Odisha: [20.5, 84.4],
  Puducherry: [11.9, 79.8],
  Punjab: [31.0, 75.4],
  Rajasthan: [26.6, 73.8],
  Sikkim: [27.5, 88.5],
  'Tamil Nadu': [11.1, 78.6],
  Telangana: [17.9, 79.0],
  Tripura: [23.9, 91.9],
  'Uttar Pradesh': [26.9, 80.9],
  Uttarakhand: [30.1, 79.2],
  'West Bengal': [23.0, 87.9],
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

// Initial compass bearing from point 1 to point 2, degrees clockwise from north.
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r)
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r)
  return ((Math.atan2(y, x) / r) + 360) % 360
}
