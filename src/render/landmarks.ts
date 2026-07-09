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

/** Footprint area (m², shoelace) — used to tell commercial blocks from houses. */
function footprintArea(p: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  }
  return Math.abs(a) / 2;
}

// Two façade palettes, chosen so the corridor reads as a real townscape rather
// than a field of identical gray blocks: warm plaster/brick tones for small
// (residential) footprints, cooler office grays for large ones. Roofs get their
// own neutral tone so tops don't blend into walls.
const WALL_RESIDENTIAL = [0xcdb89b, 0xc6a88b, 0xbfa78d, 0xd4c6a6, 0xb59a7e, 0xcabfad]
  .map((h) => new THREE.Color(h));
const WALL_COMMERCIAL = [0xbcc0c5, 0xacb2b8, 0xc4c8cb, 0xa4abb1, 0xb7c0c7, 0x9ea6ab]
  .map((h) => new THREE.Color(h));
const ROOF_RESIDENTIAL = new THREE.Color(0x6d6157);
const ROOF_COMMERCIAL = new THREE.Color(0x7c8085);
const COMMERCIAL_AREA = 500; // m² footprint above which a building reads as commercial

/** Stable per-building hash from its first vertex, so colors don't flicker. */
function buildingHash(b: Building): number {
  const x = Math.round(b.p[0][0]);
  const z = Math.round(b.p[0][1]);
  const h = (x * 73856093) ^ (z * 19349663);
  return (h >>> 0) % 1000;
}

/**
 * Paint a building's vertices: one palette color for the walls (picked by
 * footprint size + hash) and a distinct roof tone for the top cap. Adds a
 * `color` attribute so buildings can share one vertex-colored merged mesh.
 */
function paintBuilding(geo: THREE.BufferGeometry, b: Building): void {
  const commercial = footprintArea(b.p) >= COMMERCIAL_AREA;
  const palette = commercial ? WALL_COMMERCIAL : WALL_RESIDENTIAL;
  const wall = palette[buildingHash(b) % palette.length];
  const roof = commercial ? ROOF_COMMERCIAL : ROOF_RESIDENTIAL;

  geo.computeBoundingBox();
  const maxY = geo.boundingBox!.max.y;
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) >= maxY - 0.05 ? roof : wall;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
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
    // Wind triangles so the ribbon's normal points up (+Y): the other winding
    // faces the road downward, and FrontSide culling then hides it entirely.
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
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

/**
 * Street rendering tiers: majors sit a touch higher than minors so crossing
 * roads never z-fight, and each tier gets its own tint so the hierarchy reads
 * at a glance. `stripe` adds a pale center line on the big arterials.
 */
const ROAD_TIERS: Array<{
  match: (cls: string) => boolean;
  y: number;
  color: number;
  stripe: boolean;
}> = [
  // Tints run near-white: they multiply the (dark) asphalt texture, so a low
  // gray here crushed roads to near-black. These land them at a realistic
  // mid-gray pavement tone, majors a touch lighter than side streets.
  { match: (c) => c === "motorway" || c === "trunk", y: 0.21, color: 0xdcdde0, stripe: true },
  { match: (c) => c === "primary" || c === "secondary", y: 0.18, color: 0xd2d3d6, stripe: true },
  { match: (c) => c === "tertiary", y: 0.15, color: 0xc8c8c8, stripe: false },
  { match: () => true, y: 0.12, color: 0xbdbdba, stripe: false }, // residential & rest
];

export function buildLandmarks(data: LandmarksData): THREE.Group {
  const group = new THREE.Group();

  // Roads first (flat, just above ground to avoid z-fighting with the grid),
  // one merged mesh per tier.
  const asphalt = loadTextureSet("asphalt");
  const stripeGeos: THREE.BufferGeometry[] = [];
  const buckets: Road[][] = ROAD_TIERS.map(() => []);
  for (const r of data.roads) {
    const cls = r.c ?? "tertiary";
    buckets[ROAD_TIERS.findIndex((t) => t.match(cls))].push(r);
  }
  for (const [ti, tier] of ROAD_TIERS.entries()) {
    const roads = buckets[ti];
    const geos = roads.map((r) => roadGeometry(r, tier.y)).filter((g): g is THREE.BufferGeometry => !!g);
    if (!geos.length) continue;
    const mat = new THREE.MeshStandardMaterial({
      map: asphalt.map,
      normalMap: asphalt.normalMap,
      roughnessMap: asphalt.roughnessMap,
      color: tier.color,
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.receiveShadow = true;
    group.add(mesh);

    if (tier.stripe) {
      for (const r of roads) {
        const g = roadGeometry({ ...r, w: 0.35 }, tier.y + 0.015);
        if (g) stripeGeos.push(g);
      }
    }
  }
  if (stripeGeos.length) {
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8d2b8, roughness: 0.8 });
    group.add(new THREE.Mesh(mergeGeometries(stripeGeos, false), stripeMat));
  }

  // Buildings extruded to height, each painted with a per-building façade +
  // roof color so the merged mesh reads as a varied townscape.
  const bGeos: THREE.BufferGeometry[] = [];
  for (const b of data.buildings) {
    const g = buildingGeometry(b);
    if (!g) continue;
    paintBuilding(g, b);
    bGeos.push(g);
  }
  if (bGeos.length) {
    const merged = mergeGeometries(bGeos, false);
    const concrete = loadTextureSet("concrete");
    for (const tx of [concrete.map, concrete.normalMap, concrete.roughnessMap]) {
      tx.repeat.set(0.18, 0.18); // ExtrudeGeometry UVs are in world meters
    }
    // Texture supplies surface detail; per-vertex colors supply the tint, so
    // the material color stays white to let those show through unmodulated.
    const mat = new THREE.MeshStandardMaterial({
      map: concrete.map,
      normalMap: concrete.normalMap,
      roughnessMap: concrete.roughnessMap,
      vertexColors: true,
      color: 0xffffff,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}
