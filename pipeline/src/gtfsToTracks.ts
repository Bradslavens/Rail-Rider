// GTFS -> game-ready track JSON.
//
// Reads the extracted MTS GTFS feed in pipeline/raw, keeps only light-rail
// routes (route_type == 0), builds one representative track per
// (route, direction), and snaps each line's scheduled stops onto its geometry.
// Emits tracks.json, stations.json and meta.json into pipeline/out.
//
// Run: node pipeline/src/gtfsToTracks.ts

import {
  readFileSync,
  writeFileSync,
  createReadStream,
  mkdirSync,
  existsSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsvLine, headerIndex } from "./csv.ts";
import { centroid, project } from "./geo.ts";
import type { LatLon, Vec2 } from "./geo.ts";
import { dedupe, resample, cumulativeLengths } from "./polyline.ts";
import { projectToPolyline } from "./project.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, "../raw");
const OUT = resolve(HERE, "../out");
const SOURCE_URL = "https://www.sdmts.com/google_transit_files/google_transit.zip";
const LIGHT_RAIL = "0"; // GTFS route_type for tram / streetcar / light rail
const RESAMPLE_SPACING_M = 5;

interface CsvTable {
  idx: Record<string, number>;
  rows: string[][];
}

function readCsv(path: string): CsvTable {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const idx = headerIndex(parseCsvLine(lines[0]));
  const rows = lines.slice(1).map(parseCsvLine);
  return { idx, rows };
}

/** Stream a large CSV, parsing only rows whose first column is in `wanted`. */
function streamRowsByFirstColumn(
  path: string,
  wanted: Set<string>,
  onRow: (idx: Record<string, number>, fields: string[]) => void,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const rl = createInterface({
      input: createReadStream(path),
      crlfDelay: Infinity,
    });
    let idx: Record<string, number> | null = null;
    rl.on("line", (line) => {
      if (idx === null) {
        idx = headerIndex(parseCsvLine(line));
        return;
      }
      const firstComma = line.indexOf(",");
      const key = firstComma === -1 ? line : line.slice(0, firstComma);
      if (!wanted.has(key)) return;
      onRow(idx, parseCsvLine(line));
    });
    rl.on("close", () => resolvePromise());
    rl.on("error", reject);
  });
}

interface Route {
  shortName: string;
  longName: string;
  colorHex: string;
}
interface Trip {
  tripId: string;
  routeId: string;
  directionId: string;
  directionName: string;
  shapeId: string;
}
interface ShapePoint extends LatLon {
  seq: number;
}
interface TrackStation {
  stationId: string;
  name: string;
  distAlong: number;
}
interface Track {
  routeId: string;
  shortName: string;
  longName: string;
  colorHex: string;
  directionId: string;
  directionName: string;
  shapeId: string;
  lengthM: number;
  points: { x: number; z: number; dist: number }[];
  stations: TrackStation[];
}

async function main(): Promise<void> {
  if (!existsSync(resolve(RAW, "routes.txt"))) {
    throw new Error(`GTFS files not found in ${RAW}. Download/extract the feed first.`);
  }

  // --- routes: keep light rail only ---------------------------------------
  const routes = new Map<string, Route>();
  const routesTbl = readCsv(resolve(RAW, "routes.txt"));
  for (const row of routesTbl.rows) {
    if (row[routesTbl.idx.route_type]?.trim() !== LIGHT_RAIL) continue;
    const color = row[routesTbl.idx.route_color]?.trim() || "888888";
    routes.set(row[routesTbl.idx.route_id], {
      shortName: row[routesTbl.idx.route_short_name] ?? "",
      longName: row[routesTbl.idx.route_long_name] ?? "",
      colorHex: `#${color}`,
    });
  }

  // --- trips for those routes ---------------------------------------------
  const trips: Trip[] = [];
  const tripsTbl = readCsv(resolve(RAW, "trips.txt"));
  const dirNameCol = tripsTbl.idx.direction_name;
  for (const row of tripsTbl.rows) {
    const routeId = row[tripsTbl.idx.route_id];
    if (!routes.has(routeId)) continue;
    trips.push({
      tripId: row[tripsTbl.idx.trip_id],
      routeId,
      directionId: row[tripsTbl.idx.direction_id] ?? "",
      directionName: dirNameCol !== undefined ? (row[dirNameCol] ?? "") : "",
      shapeId: row[tripsTbl.idx.shape_id] ?? "",
    });
  }

  // --- shapes used by those trips -----------------------------------------
  const neededShapes = new Set(trips.map((t) => t.shapeId).filter(Boolean));
  const shapePts = new Map<string, ShapePoint[]>();
  const shapesTbl = readCsv(resolve(RAW, "shapes.txt"));
  for (const row of shapesTbl.rows) {
    const sid = row[shapesTbl.idx.shape_id];
    if (!neededShapes.has(sid)) continue;
    const list = shapePts.get(sid) ?? [];
    list.push({
      seq: Number(row[shapesTbl.idx.shape_pt_sequence]),
      lat: Number(row[shapesTbl.idx.shape_pt_lat]),
      lon: Number(row[shapesTbl.idx.shape_pt_lon]),
    });
    shapePts.set(sid, list);
  }
  for (const list of shapePts.values()) list.sort((a, b) => a.seq - b.seq);

  // --- world origin = centroid of all trolley shape points ----------------
  const allLatLon: LatLon[] = [];
  for (const list of shapePts.values()) for (const p of list) allLatLon.push(p);
  const origin = centroid(allLatLon);

  // --- pick a representative shape per (route, direction) ------------------
  const usage = new Map<string, Map<string, number>>(); // groupKey -> shapeId -> count
  const groupMeta = new Map<string, Trip>(); // groupKey -> any trip (for names)
  const groupKey = (routeId: string, dir: string) => `${routeId}::${dir}`;
  for (const t of trips) {
    if (!shapePts.has(t.shapeId)) continue;
    const key = groupKey(t.routeId, t.directionId);
    const byShape = usage.get(key) ?? new Map<string, number>();
    byShape.set(t.shapeId, (byShape.get(t.shapeId) ?? 0) + 1);
    usage.set(key, byShape);
    if (!groupMeta.has(key)) groupMeta.set(key, t);
  }

  const tracks: Track[] = [];
  const repTripByGroup = new Map<string, string>();
  for (const [key, byShape] of usage) {
    // most-used shape; tiebreak by more points (longer geometry)
    let bestShape = "";
    let bestCount = -1;
    for (const [sid, count] of byShape) {
      const better =
        count > bestCount ||
        (count === bestCount &&
          (shapePts.get(sid)?.length ?? 0) > (shapePts.get(bestShape)?.length ?? 0));
      if (better) {
        bestShape = sid;
        bestCount = count;
      }
    }

    const meta = groupMeta.get(key)!;
    const route = routes.get(meta.routeId)!;
    const worldPts: Vec2[] = shapePts.get(bestShape)!.map((p) => project(p, origin));
    const resampled = resample(dedupe(worldPts), RESAMPLE_SPACING_M);
    const cum = cumulativeLengths(resampled);
    tracks.push({
      routeId: meta.routeId,
      shortName: route.shortName,
      longName: route.longName,
      colorHex: route.colorHex,
      directionId: meta.directionId,
      directionName: meta.directionName,
      shapeId: bestShape,
      lengthM: cum[cum.length - 1],
      points: resampled.map((p, i) => ({
        x: round(p.x),
        z: round(p.z),
        dist: round(cum[i]),
      })),
      stations: [],
    });

    // pick a representative trip that actually uses the chosen shape
    const repTrip = trips.find(
      (t) => groupKey(t.routeId, t.directionId) === key && t.shapeId === bestShape,
    );
    if (repTrip) repTripByGroup.set(key, repTrip.tripId);
  }

  // --- scheduled stops for the representative trips (stream big file) ------
  const repTripIds = new Set(repTripByGroup.values());
  const stopSeqByTrip = new Map<string, { stopId: string; seq: number }[]>();
  await streamRowsByFirstColumn(
    resolve(RAW, "stop_times.txt"),
    repTripIds,
    (idx, f) => {
      const tripId = f[idx.trip_id];
      const list = stopSeqByTrip.get(tripId) ?? [];
      list.push({ stopId: f[idx.stop_id], seq: Number(f[idx.stop_sequence]) });
      stopSeqByTrip.set(tripId, list);
    },
  );

  // --- stop coordinates ----------------------------------------------------
  const neededStops = new Set<string>();
  for (const list of stopSeqByTrip.values()) for (const s of list) neededStops.add(s.stopId);
  const stops = new Map<string, { name: string; lat: number; lon: number }>();
  const stopsTbl = readCsv(resolve(RAW, "stops.txt"));
  for (const row of stopsTbl.rows) {
    const id = row[stopsTbl.idx.stop_id];
    if (!neededStops.has(id)) continue;
    stops.set(id, {
      name: row[stopsTbl.idx.stop_name] ?? id,
      lat: Number(row[stopsTbl.idx.stop_lat]),
      lon: Number(row[stopsTbl.idx.stop_lon]),
    });
  }

  // --- place stations on each track ---------------------------------------
  const globalStations = new Map<
    string,
    { id: string; name: string; x: number; z: number; routeIds: Set<string> }
  >();
  for (const track of tracks) {
    const key = groupKey(track.routeId, track.directionId);
    const repTrip = repTripByGroup.get(key);
    const seq = repTrip ? (stopSeqByTrip.get(repTrip) ?? []) : [];
    const resampled: Vec2[] = track.points.map((p) => ({ x: p.x, z: p.z }));

    const placed: TrackStation[] = [];
    for (const s of seq.sort((a, b) => a.seq - b.seq)) {
      const stop = stops.get(s.stopId);
      if (!stop) continue;
      const world = project(stop, origin);
      const proj = projectToPolyline(world, resampled);
      placed.push({ stationId: s.stopId, name: stop.name, distAlong: round(proj.distAlong) });

      const g = globalStations.get(s.stopId) ?? {
        id: s.stopId,
        name: stop.name,
        x: round(world.x),
        z: round(world.z),
        routeIds: new Set<string>(),
      };
      g.routeIds.add(track.routeId);
      globalStations.set(s.stopId, g);
    }
    placed.sort((a, b) => a.distAlong - b.distAlong);
    track.stations = placed;
  }

  // --- meta + bounding box -------------------------------------------------
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of tracks) {
    for (const p of t.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }

  const feedInfo = readFeedVersion();
  const totalTrackKm = tracks.reduce((sum, t) => sum + t.lengthM, 0) / 1000;
  const stations = [...globalStations.values()].map((g) => ({
    id: g.id,
    name: g.name,
    x: g.x,
    z: g.z,
    routeIds: [...g.routeIds],
  }));

  const meta = {
    source: "San Diego MTS / SANDAG GTFS",
    sourceUrl: SOURCE_URL,
    feedVersion: feedInfo.version,
    fetchedAt: new Date().toISOString().slice(0, 10),
    origin,
    earthRadiusM: 6371000,
    resampleSpacingM: RESAMPLE_SPACING_M,
    bbox: { minX: round(minX), maxX: round(maxX), minZ: round(minZ), maxZ: round(maxZ) },
    routeCount: routes.size,
    trackCount: tracks.length,
    stationCount: stations.length,
    totalTrackKm: round(totalTrackKm),
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "tracks.json"), JSON.stringify(tracks, null, 2));
  writeFileSync(resolve(OUT, "stations.json"), JSON.stringify(stations, null, 2));
  writeFileSync(resolve(OUT, "meta.json"), JSON.stringify(meta, null, 2));

  printSummary(tracks, meta);
}

function readFeedVersion(): { version: string } {
  try {
    const tbl = readCsv(resolve(RAW, "feed_info.txt"));
    return { version: tbl.rows[0]?.[tbl.idx.feed_version] ?? "unknown" };
  } catch {
    return { version: "unknown" };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function printSummary(tracks: Track[], meta: Record<string, unknown>): void {
  console.log("\nRail Rider — GTFS pipeline complete");
  console.log("===================================");
  console.log(`Feed version : ${meta.feedVersion}`);
  console.log(`Light-rail routes : ${meta.routeCount}`);
  console.log(`Tracks (route x direction) : ${meta.trackCount}`);
  console.log(`Stations : ${meta.stationCount}`);
  console.log(`Total track : ${meta.totalTrackKm} km`);
  const b = meta.bbox as Record<string, number>;
  console.log(
    `World bbox : ${round(b.maxX - b.minX)} m (E-W) x ${round(b.maxZ - b.minZ)} m (N-S)`,
  );
  console.log("\nPer track:");
  for (const t of tracks) {
    const dir = t.directionName || `dir ${t.directionId}`;
    console.log(
      `  ${t.shortName.padEnd(7)} ${dir.padEnd(22)} ${round(t.lengthM / 1000)
        .toString()
        .padStart(6)} km  ${t.stations.length} stops  (${t.points.length} pts)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
