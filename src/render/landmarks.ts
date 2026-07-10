import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LandmarksData, Building, Road, Green, Pt2 } from "../core/types.ts";
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
  // gray here crushed roads to near-black. Lifted so pavement reads as a light
  // mid-gray against the brighter daytime grass, majors lighter than side streets.
  { match: (c) => c === "motorway" || c === "trunk", y: 0.21, color: 0xf2f3f5, stripe: true },
  { match: (c) => c === "primary" || c === "secondary", y: 0.18, color: 0xe9eaec, stripe: true },
  { match: (c) => c === "tertiary", y: 0.15, color: 0xdedede, stripe: false },
  { match: () => true, y: 0.12, color: 0xd2d2ce, stripe: false }, // residential & rest
];

// --- Greenery ---------------------------------------------------------------

/** Deterministic pseudo-random in [0,1) from an integer seed (mulberry32). */
function rand(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pointInPolygon(x: number, z: number, ring: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function polyArea(ring: Pt2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

// Ground tint per green category (multiplies the grass texture).
const GREEN_TINT: Record<Green["k"], number> = {
  wood: 0x4c6136,
  park: 0x6f8a49,
  grass: 0x788f4f,
};
// Approx spacing (m) between scattered trees; grass areas get none.
const SCATTER_SPACING: Record<Green["k"], number> = { wood: 7, park: 15, grass: 0 };
const MAX_TREES = 60000;

/** Flat tinted ground patches for green areas, one merged mesh. */
function buildGreens(greens: Green[]): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const g of greens) {
    if (g.p.length < 3) continue;
    const shape = new THREE.Shape();
    shape.moveTo(g.p[0][0], -g.p[0][1]);
    for (let i = 1; i < g.p.length; i++) shape.lineTo(g.p[i][0], -g.p[i][1]);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); // shape XY -> world XZ
    geo.translate(0, 0.05, 0); // just above grass, below roads (0.12)
    const c = new THREE.Color(GREEN_TINT[g.k]);
    const pos = geo.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geos.push(geo);
  }
  if (!geos.length) return null;
  // No map: the shared grass texture's repeat is tuned for the giant ground
  // plane and would moiré on small patches, so greens are flat vertex-colored.
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Collect tree positions: mapped trees plus scatter inside wooded/park greens. */
function treePositions(data: LandmarksData): Pt2[] {
  const out: Pt2[] = [];
  for (const t of data.trees ?? []) out.push(t);
  for (const g of data.greens ?? []) {
    const spacing = SCATTER_SPACING[g.k];
    if (!spacing || g.p.length < 3) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of g.p) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const target = Math.min(400, Math.floor(polyArea(g.p) / (spacing * spacing)));
    let placed = 0;
    for (let a = 0; a < target * 4 && placed < target; a++) {
      const s = (g.p[0][0] * 131 + g.p[0][1] * 977 + a) | 0;
      const x = minX + rand(s) * (maxX - minX);
      const z = minZ + rand(s * 2 + 1) * (maxZ - minZ);
      if (pointInPolygon(x, z, g.p)) {
        out.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
        placed++;
      }
    }
  }
  return out.length > MAX_TREES ? out.filter((_, i) => i % Math.ceil(out.length / MAX_TREES) === 0) : out;
}

// Low-poly foliage tones (flat-shaded), varied per instance.
const LEAF_COLORS = [0x4a6b32, 0x5c7a3a, 0x3f5d2c, 0x6b8446, 0x557539].map((h) => new THREE.Color(h));

/** Instanced low-poly trees (5-sided trunk + icosahedron canopy) at each point. */
function buildTrees(positions: Pt2[]): THREE.Group {
  const group = new THREE.Group();
  const n = positions.length;
  if (!n) return group;

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 2.4, 5);
  trunkGeo.translate(0, 1.2, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1.5, 0);
  leafGeo.translate(0, 3.3, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4634, roughness: 0.95, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const eul = new THREE.Euler();

  for (let i = 0; i < n; i++) {
    const [x, z] = positions[i];
    const seed = (x * 92821 + z * 68917) | 0;
    const s = 0.75 + rand(seed) * 0.8;
    eul.set(0, rand(seed * 3 + 7) * Math.PI * 2, 0);
    q.setFromEuler(eul);
    scl.set(s, s * (0.85 + rand(seed * 5 + 3) * 0.5), s);
    pos.set(x, 0, z);
    m.compose(pos, q, scl);
    trunks.setMatrixAt(i, m);
    leaves.setMatrixAt(i, m);
    leaves.setColorAt(i, LEAF_COLORS[Math.floor(rand(seed * 7 + 1) * LEAF_COLORS.length)]);
  }
  trunks.castShadow = true;
  leaves.castShadow = true;
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(trunks, leaves);
  return group;
}

// --- Street-name labels ------------------------------------------------------

const labelTexCache = new Map<string, THREE.CanvasTexture>();
const labelMatCache = new Map<string, THREE.SpriteMaterial>();

/** Billboard material for a street name (texture + material shared per name). */
function labelMaterial(name: string): THREE.SpriteMaterial {
  const hit = labelMatCache.get(name);
  if (hit) return hit;
  const mat = new THREE.SpriteMaterial({
    map: labelTexture(name),
    transparent: true,
    depthWrite: false,
    depthTest: true, // signs are hidden behind buildings in front of them
  });
  labelMatCache.set(name, mat);
  return mat;
}

/** Street name drawn on a dark rounded plaque so it reads against any backdrop. */
function labelTexture(name: string): THREE.CanvasTexture {
  const hit = labelTexCache.get(name);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const fontPx = 60;
  const font = `600 ${fontPx}px system-ui, Arial, sans-serif`;
  ctx.font = font;
  const padX = 26;
  const padY = 16;
  canvas.width = Math.ceil(ctx.measureText(name).width) + padX * 2;
  canvas.height = fontPx + padY * 2;

  // Rounded translucent plaque background with a subtle border.
  const r = canvas.height / 2;
  ctx.beginPath();
  ctx.roundRect(1, 1, canvas.width - 2, canvas.height - 2, r);
  ctx.fillStyle = "rgba(24,28,34,0.78)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.stroke();

  ctx.font = font; // reset after the resize cleared it
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f6f4ec";
  ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = false; // canvas is non-power-of-two
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  labelTexCache.set(name, tex);
  return tex;
}

/** Surface height of a road tier (labels float a fixed distance above this). */
function roadTierY(cls: string): number {
  for (const t of ROAD_TIERS) if (t.match(cls)) return t.y;
  return 0.12;
}

const SIGN_HEIGHT = 2.6; // world height of the plaque (m)
const SIGN_FLOAT = 6.5; // meters the sign floats above the road

/**
 * A floating street-name sign hovering above each named road's midpoint. Each
 * is a camera-facing billboard (THREE.Sprite) so it stays readable from any
 * angle — unlike flat pavement text, which vanishes at grazing view angles.
 * Materials/textures are shared per unique street name; the frustum culls
 * off-screen signs and distance attenuation shrinks far ones.
 */
function buildRoadLabels(roads: Road[]): THREE.Group {
  const group = new THREE.Group();
  for (const r of roads) {
    if (!r.n || r.p.length < 2) continue;

    let total = 0;
    for (let i = 1; i < r.p.length; i++)
      total += Math.hypot(r.p[i][0] - r.p[i - 1][0], r.p[i][1] - r.p[i - 1][1]);
    if (total < 25) continue; // too short to bother signing

    // Point at the halfway distance along the road.
    let acc = 0;
    let cx = r.p[0][0];
    let cz = r.p[0][1];
    const half = total / 2;
    for (let i = 1; i < r.p.length; i++) {
      const [ax, az] = r.p[i - 1];
      const [bx, bz] = r.p[i];
      const seg = Math.hypot(bx - ax, bz - az);
      if (acc + seg >= half) {
        const t = (half - acc) / (seg || 1);
        cx = ax + (bx - ax) * t;
        cz = az + (bz - az) * t;
        break;
      }
      acc += seg;
    }

    const mat = labelMaterial(r.n);
    const img = mat.map!.image as HTMLCanvasElement;
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(SIGN_HEIGHT * (img.width / img.height), SIGN_HEIGHT, 1);
    sprite.position.set(cx, roadTierY(r.c ?? "tertiary") + SIGN_FLOAT, cz);
    group.add(sprite);
  }
  return group;
}

export function buildLandmarks(data: LandmarksData): THREE.Group {
  const group = new THREE.Group();

  // Green areas under everything else (tinted ground), then their trees.
  const greensMesh = buildGreens(data.greens ?? []);
  if (greensMesh) group.add(greensMesh);
  group.add(buildTrees(treePositions(data)));

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
    // polygonOffset pulls the stripe toward the camera in the depth buffer so it
    // reliably wins over the road beneath it. Without this the tiny 0.015 m gap
    // falls below depth precision at range and the stripe flickers on/off ("jumps
    // and skips") as the camera moves.
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xd8d2b8,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    group.add(new THREE.Mesh(mergeGeometries(stripeGeos, false), stripeMat));
  }

  // Street-name labels painted flat along each named road.
  group.add(buildRoadLabels(data.roads));

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
