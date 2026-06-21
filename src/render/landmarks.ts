import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LandmarksData, Building, Road } from "../core/types.ts";

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
  const verts: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (let i = 0; i < r.p.length - 1; i++) {
    const [ax, az] = r.p[i];
    const [bx, bz] = r.p[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * half; // perpendicular offset
    const nz = (dx / len) * half;
    verts.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    base += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
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
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95 });
    group.add(new THREE.Mesh(merged, mat));
  }

  // Buildings extruded to height.
  const bGeos = data.buildings.map(buildingGeometry).filter((g): g is THREE.BufferGeometry => !!g);
  if (bGeos.length) {
    const merged = mergeGeometries(bGeos, false);
    const mat = new THREE.MeshStandardMaterial({ color: 0x556070, roughness: 0.85, metalness: 0.05 });
    group.add(new THREE.Mesh(merged, mat));
  }

  return group;
}
