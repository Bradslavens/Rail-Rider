// Convert WGS84 lat/lon into a local East-North-Up tangent plane in meters,
// using an equirectangular approximation around a chosen origin. Good enough
// for a ~50 km metro area; UTM Zone 11N is the "proper" alternative if higher
// accuracy is ever needed.

export const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** A point in the local world plane. x = East (m), z = North-negated (m). */
export interface Vec2 {
  x: number;
  z: number;
}

/** Arithmetic mean of lat/lon over the given points (the world origin). */
export function centroid(points: LatLon[]): LatLon {
  if (points.length === 0) throw new Error("centroid of empty point set");
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / points.length, lon: lon / points.length };
}

/**
 * Project a lat/lon to local meters relative to `origin`.
 * North maps to -Z so that North is "into the screen" in Three.js's
 * right-handed, Y-up world.
 */
export function project(p: LatLon, origin: LatLon): Vec2 {
  const x = (p.lon - origin.lon) * DEG * Math.cos(origin.lat * DEG) * EARTH_RADIUS_M;
  const z = -((p.lat - origin.lat) * DEG) * EARTH_RADIUS_M;
  return { x, z };
}
