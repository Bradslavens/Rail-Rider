import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LandmarksData, Building, Road } from "../core/types.ts";
import { loadTextureSet } from "./textures.ts";

// Render OSM landmarks: building footprints extruded to their height and roads
// as flat ribbons. Geometry per category is merged into a single mesh so the
// whole corridor draws in a couple of draw calls.

/** Extrude one building footprint into a solid that rises from the ground. */
function buildingGeometry(b: Building): THREE.BufferGeometry | null {
  if (b.p.length < 3) return null;
  const shape = new THREE.Shape();
  // Footprint (x, z) -> shape (x, -z) so that after rotateX(-90°) the solid
  // sits at the right place in world XZ and rises along +Y by its height.
  shape.moveTo(b.p[0][0], -b.p[0][1]);
  for (let i = 1; i < b.p.length; i++) shape.lineTo(b.p[i][0], -b.p[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Build a flat ribbon mesh geometry for a road centreline of width w. */
function roadGeometry(r: Road, y: number): THREE.BufferGeometry | null {
  if (r.p.length < 2) return null;
  const half = r.w / 2;
  const TILE = 6; // meters per asphalt tile
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  let base = 0;
  let dist = 0;
  for (let i = 0; i < r.p.length - 1; i++) {
    const [ax, az] = r.p[i];
    const [bx, bz] = r.p[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * half; // perpendicular offset
    const nz = (dx / len) * half;
    verts.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
    const v0 = dist / TILE;
    const v1 = (dist + len) / TILE;
    uvs.push(0, v0, 1, v0, 0, v1, 1, v1);
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    base += 4;
    dist += len;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildLandmarks(data: LandmarksData): THREE.Group {
  const group = new THREE.Group();

  // Roads first (flat, just above ground to avoid z-fighting with the grid).
  const roadGeos = data.roads.map((r) => roadGeometry(r, 0.15)).filter((g): g is THREE.BufferGeometry => !!g);
  if (roadGeos.length) {
    const merged = mergeGeometries(roadGeos, false);
    const asphalt = loadTextureSet("asphalt");
    const mat = new THREE.MeshStandardMaterial({
      map: asphalt.map,
      normalMap: asphalt.normalMap,
      roughnessMap: asphalt.roughnessMap,
      color: 0x9a9a9a,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Buildings extruded to height.
  const bGeos = data.buildings.map(buildingGeometry).filter((g): g is THREE.BufferGeometry => !!g);
  if (bGeos.length) {
    const merged = mergeGeometries(bGeos, false);
    const concrete = loadTextureSet("concrete");
    for (const tx of [concrete.map, concrete.normalMap, concrete.roughnessMap]) {
      tx.repeat.set(0.18, 0.18); // ExtrudeGeometry UVs are in world meters
    }
    const mat = new THREE.MeshStandardMaterial({
      map: concrete.map,
      normalMap: concrete.normalMap,
      roughnessMap: concrete.roughnessMap,
      color: 0xb9beb6,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}
