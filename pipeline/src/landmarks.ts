// OSM landmarks -> game-ready JSON.
//
// Pulls buildings, major roads, level crossings and stations within a corridor
// around the MTS rail lines from the Overpass API, reprojects them with the
// SAME origin as the tracks (meta.json), and emits pipeline/out/landmarks.json.
// Raw Overpass responses are cached in pipeline/raw (gitignored) so re-runs are
// offline; delete them (or pass --force) to refresh.
//
// Run: node pipeline/src/landmarks.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { project, unproject } from "./geo.ts";
import type { LatLon, Vec2 } from "./geo.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, "../raw");
const OUT = resolve(HERE, "../out");
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const FORCE = process.argv.includes("--force");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Optional `--line <shortName>` restricts the corridor to one line (e.g. the
// small Copper line) to keep the Overpass query fast. Default: all lines.
const lineArgIdx = process.argv.indexOf("--line");
const LINE_FILTER = lineArgIdx >= 0 ? (process.argv[lineArgIdx + 1] ?? "").toLowerCase() : "";

const CORRIDOR_STEP_M = 90; // spacing of corridor probe points
const DEDUPE_GRID_DEG = 0.0004; // ~44 m grid to thin probe points

interface TrackPoint { x: number; z: number; dist: number }
interface Track { shapeId: string; shortName: string; points: TrackPoint[] }
interface Meta { origin: LatLon }

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// --- corridor probe points (lat/lon) -------------------------------------
function corridorPoints(tracks: Track[], origin: LatLon): LatLon[] {
  const seen = new Set<string>();
  const out: LatLon[] = [];
  for (const t of tracks) {
    let last = -Infinity;
    for (const p of t.points) {
      if (p.dist - last < CORRIDOR_STEP_M) continue;
      last = p.dist;
      const ll = unproject({ x: p.x, z: p.z }, origin);
      const key = `${Math.round(ll.lat / DEDUPE_GRID_DEG)}_${Math.round(ll.lon / DEDUPE_GRID_DEG)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ll);
    }
  }
  return out;
}

// --- Overpass fetch (cached) ---------------------------------------------
async function overpass(name: string, statement: string): Promise<OsmElement[]> {
  const cache = resolve(RAW, `osm-${LINE_FILTER || "all"}-${name}.json`);
  if (!FORCE && existsSync(cache)) {
    console.log(`  ${name}: cached`);
    return JSON.parse(readFileSync(cache, "utf8")).elements ?? [];
  }
  const query = `[out:json][timeout:240];(${statement};);out geom;`;
  console.log(`  ${name}: querying Overpass (${(query.length / 1024).toFixed(0)} KB query)…`);

  // The public Overpass servers are shared and frequently return 429/504; retry
  // with backoff, rotating endpoints, before giving up.
  let lastErr = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "rail-rider/0.1 (MTS trolley training sim; github.com/Bradslavens/Rail-Rider)",
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(180000),
      });
      if (res.ok) {
        const text = await res.text();
        writeFileSync(cache, text);
        console.log(`  ${name}: ${(text.length / 1e6).toFixed(2)} MB cached`);
        return JSON.parse(text).elements ?? [];
      }
      lastErr = `${res.status} ${res.statusText}`;
    } catch (err) {
      lastErr = String(err);
    }
    const wait = 3000 * (attempt + 1);
    console.log(`    attempt ${attempt + 1} failed (${lastErr}); retrying in ${wait / 1000}s…`);
    await sleep(wait);
  }
  throw new Error(`Overpass ${name} failed after retries: ${lastErr}`);
}

// --- processing ----------------------------------------------------------
function projectRing(geom: { lat: number; lon: number }[], origin: LatLon): [number, number][] {
  const ring: [number, number][] = [];
  for (const g of geom) {
    const v = project({ lat: g.lat, lon: g.lon }, origin);
    const last = ring[ring.length - 1];
    // Drop points closer than 2 m to the previous (cheap decimation).
    if (last && Math.hypot(v.x - last[0], v.z - last[1]) < 2) continue;
    ring.push([r1(v.x), r1(v.z)]);
  }
  return ring;
}

function buildingHeight(tags: Record<string, string> = {}): number {
  if (tags.height) {
    const h = parseFloat(tags.height);
    if (!Number.isNaN(h)) return r1(h);
  }
  const levels = parseFloat(tags["building:levels"] ?? "");
  if (!Number.isNaN(levels)) return r1(Math.max(3, levels * 3.2));
  return 7; // default low-rise
}

function centroidLocal(geom: { lat: number; lon: number }[], origin: LatLon): Vec2 {
  let x = 0;
  let z = 0;
  for (const g of geom) {
    const v = project(g, origin);
    x += v.x;
    z += v.z;
  }
  return { x: x / geom.length, z: z / geom.length };
}

async function main(): Promise<void> {
  const meta = JSON.parse(readFileSync(resolve(OUT, "meta.json"), "utf8")) as Meta;
  let tracks = JSON.parse(readFileSync(resolve(OUT, "tracks.json"), "utf8")) as Track[];
  mkdirSync(RAW, { recursive: true });

  if (LINE_FILTER) {
    tracks = tracks.filter((t) => t.shortName.toLowerCase() === LINE_FILTER);
    if (tracks.length === 0) throw new Error(`No tracks match --line ${LINE_FILTER}`);
    console.log(`Line filter: ${LINE_FILTER} (${tracks.length} tracks)`);
  }

  const probes = corridorPoints(tracks, meta.origin);
  const pts = probes.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(",");
  console.log(`Corridor: ${probes.length} probe points`);

  const buildingEls = await overpass("buildings", `way(around:110,${pts})[building]`);
  const roadEls = await overpass(
    "roads",
    `way(around:100,${pts})["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|secondary|tertiary)$"]`,
  );
  const crossingEls = await overpass("crossings", `node(around:60,${pts})[railway=level_crossing]`);
  const stationEls = await overpass(
    "stations",
    `node(around:150,${pts})[railway~"^(station|tram_stop|halt)$"];way(around:150,${pts})["public_transport"="platform"];way(around:150,${pts})[railway=platform]`,
  );

  const buildings = buildingEls
    .filter((e) => e.type === "way" && e.geometry && e.geometry.length >= 4)
    .map((e) => ({ h: buildingHeight(e.tags), p: projectRing(e.geometry!, meta.origin) }))
    .filter((b) => b.p.length >= 3);

  const ROAD_WIDTH: Record<string, number> = {
    motorway: 18, trunk: 16, primary: 12, secondary: 10, tertiary: 8,
  };
  const roads = roadEls
    .filter((e) => e.type === "way" && e.geometry && e.geometry.length >= 2)
    .map((e) => {
      const cls = (e.tags?.highway ?? "tertiary").replace(/_link$/, "");
      return { w: ROAD_WIDTH[cls] ?? 8, p: projectRing(e.geometry!, meta.origin) };
    })
    .filter((r) => r.p.length >= 2);

  const crossings = crossingEls
    .filter((e) => e.type === "node" && e.lat !== undefined)
    .map((e) => {
      const v = project({ lat: e.lat!, lon: e.lon! }, meta.origin);
      return { x: r1(v.x), z: r1(v.z) };
    });

  const stations = stationEls
    .map((e) => {
      const v = e.geometry ? centroidLocal(e.geometry, meta.origin) : project({ lat: e.lat!, lon: e.lon! }, meta.origin);
      return { x: r1(v.x), z: r1(v.z), name: e.tags?.name ?? "" };
    });

  const result = {
    source: "OpenStreetMap via Overpass API",
    license: "ODbL — © OpenStreetMap contributors",
    generatedAt: new Date().toISOString().slice(0, 10),
    corridorRadiusM: { buildings: 110, roads: 100, crossings: 60, stations: 150 },
    counts: {
      buildings: buildings.length,
      roads: roads.length,
      crossings: crossings.length,
      stations: stations.length,
    },
    buildings,
    roads,
    crossings,
    stations,
  };
  const outPath = resolve(OUT, "landmarks.json");
  writeFileSync(outPath, JSON.stringify(result));
  const kb = (readFileSync(outPath).length / 1e6).toFixed(2);
  console.log(`\nWrote landmarks.json (${kb} MB):`, result.counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
