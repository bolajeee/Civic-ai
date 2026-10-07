/** Leaflet may expose bounds outside the world at low zoom. The API expects one geographic envelope. */
export function geographicBounds(west: number, south: number, east: number, north: number): [number, number, number, number] {
  return [Math.max(-180, west), Math.max(-90, south), Math.min(180, east), Math.min(90, north)];
}
