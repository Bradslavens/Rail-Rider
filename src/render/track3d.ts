import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TrackPoint } from "../core/types.ts";
import { loadTextureSet } from "./textures.ts";

// A 3D permanent way for the active line: a ballast strip, evenly spaced ties,
// and two steel rails — all built from the resampled centreline and merged so
// each part is a single draw call.

const BALLAST_HALF = 1.9;
const TIE_HALF = 1.4;
const TIE_SPACING = 2.5;
const GAUGE = 1.5; // visible rail spacing (m)
const RAIL_HALF = 0.09;

interface Frame {
  x: number;
  z: number;
  /** Unit perpendicular (to the side of travel). */
  px: number;
  pz: number;
  dist: number;
}

/** Sample world position + perpendicular at each centreline point. */
function frames(points: TrackPoint[]): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    out.push({ x: points[i].x, z: points[i].z, px: dz / len, pz: -dx / len, dist: points[i].dist });
  }
  return out;
}

/** A continuous ribbon of half-width `half` at height `y` along the frames. */
function ribbon(fr: Frame[], half: number, y: number, tile = 0): THREE.BufferGeometry {
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < fr.length; i++) {
    const f = fr[i];
    verts.push(f.x + f.px * half, y, f.z + f.pz * half, f.x - f.px * half, y, f.z - f.pz * half);
    if (tile > 0) uvs.push(0, f.dist / tile, 1, f.dist / tile);
  }
  for (let i = 0; i < fr.length - 1; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  if (tile > 0) geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A rail offset `lateral` from the centreline (a thin raised ribbon). */
function rail(fr: Frame[], lateral: number, y: number): THREE.BufferGeometry {
  const shifted = fr.map((f) => ({
    x: f.x + f.px * lateral,
    z: f.z + f.pz * lateral,
    px: f.px,
    pz: f.pz,
    dist: f.dist,
  }));
  return ribbon(shifted, RAIL_HALF, y);
}

export function buildTrack3D(points: TrackPoint[]): THREE.Group {
  const group = new THREE.Group();
  const fr = frames(points);

  // Ballast bed (tiled gravel).
  const gravel = loadTextureSet("ballast");
  const ballast = new THREE.Mesh(
    ribbon(fr, BALLAST_HALF, 0.06, 3),
    new THREE.MeshStandardMaterial({
      map: gravel.map,
      normalMap: gravel.normalMap,
      roughnessMap: gravel.roughnessMap,
      color: 0x9b948a,
    }),
  );
  ballast.receiveShadow = true;
  group.add(ballast);

  // Ties at a fixed spacing.
  const tieGeo = new THREE.BoxGeometry(TIE_HALF * 2, 0.16, 0.45);
  const tieGeos: THREE.BufferGeometry[] = [];
  let nextTie = 0;
  for (const f of fr) {
    if (f.dist < nextTie) continue;
    nextTie = f.dist + TIE_SPACING;
    const g = tieGeo.clone();
    g.rotateY(Math.atan2(f.px, f.pz)); // align across the track
    g.translate(f.x, 0.14, f.z);
    tieGeos.push(g);
  }
  if (tieGeos.length) {
    const ties = new THREE.Mesh(
      mergeGeometries(tieGeos, false),
      new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.95 }),
    );
    ties.receiveShadow = true;
    group.add(ties);
  }

  // Two steel rails.
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.4, metalness: 0.8 });
  const rails = new THREE.Mesh(
    mergeGeometries([rail(fr, GAUGE / 2, 0.24), rail(fr, -GAUGE / 2, 0.24)], false),
    railMat,
  );
  group.add(rails);

  return group;
}
