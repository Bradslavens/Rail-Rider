import * as THREE from "three";
import type { NetworkData } from "../core/types.ts";

export interface NetworkView {
  group: THREE.Group;
  /** Distinct lines (by route) for a legend: short name + color. */
  legend: { shortName: string; colorHex: string }[];
}

/**
 * Build the renderable network: one colored polyline per track and a single
 * Points cloud for stations (fixed pixel size so they stay visible at any zoom).
 */
export function buildNetwork(data: NetworkData): NetworkView {
  const group = new THREE.Group();
  const legendMap = new Map<string, string>();

  for (const track of data.tracks) {
    legendMap.set(track.shortName, track.colorHex);

    const positions = new Float32Array(track.points.length * 3);
    for (let i = 0; i < track.points.length; i++) {
      const p = track.points[i];
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = p.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(track.colorHex),
    });
    group.add(new THREE.Line(geometry, material));
  }

  // Stations as fixed-size white dots.
  const stationPositions = new Float32Array(data.stations.length * 3);
  for (let i = 0; i < data.stations.length; i++) {
    const s = data.stations[i];
    stationPositions[i * 3] = s.x;
    stationPositions[i * 3 + 1] = 1;
    stationPositions[i * 3 + 2] = s.z;
  }
  const stationGeo = new THREE.BufferGeometry();
  stationGeo.setAttribute("position", new THREE.BufferAttribute(stationPositions, 3));
  const stationMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 6,
    sizeAttenuation: false,
  });
  group.add(new THREE.Points(stationGeo, stationMat));

  const legend = [...legendMap.entries()].map(([shortName, colorHex]) => ({
    shortName,
    colorHex,
  }));
  return { group, legend };
}
