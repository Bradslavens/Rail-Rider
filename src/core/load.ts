import type {
  NetworkData,
  Track,
  Station,
  Meta,
  SignalSet,
  LandmarksData,
  StationEditSet,
  CrossingEditSet,
} from "./types.ts";
import { applyStationEdits, applyCrossingEdits } from "../edit/adminEdits.ts";

// Load the processed network JSON served from /data (synced from pipeline/out).
// Hand-tuned station positions (data/stationEdits.json) are layered over the
// pipeline's tracks here, so tracks.json itself stays pipeline-owned.
export async function loadNetwork(): Promise<NetworkData> {
  const [tracks, stations, meta, stationEdits] = await Promise.all([
    fetchJson<Track[]>("/data/tracks.json"),
    fetchJson<Station[]>("/data/stations.json"),
    fetchJson<Meta>("/data/meta.json"),
    loadStationEdits(),
  ]);
  return { tracks: applyStationEdits(tracks, stationEdits.edits), stations, meta };
}

/** Load the hand-authored signal set; tolerates a missing file. */
export async function loadSignals(): Promise<SignalSet> {
  try {
    const res = await fetch("/data/signals.json");
    if (!res.ok) return { signals: [] };
    return (await res.json()) as SignalSet;
  } catch {
    return { signals: [] };
  }
}

/**
 * Load OSM landmarks (buildings/roads/crossings/stations); tolerant. Crossing
 * position overrides (data/crossingEdits.json) are applied here, preserving
 * the original file's crossing order/indices.
 */
export async function loadLandmarks(): Promise<LandmarksData> {
  const empty: LandmarksData = { buildings: [], roads: [], crossings: [], stations: [] };
  try {
    const res = await fetch("/data/landmarks.json");
    if (!res.ok) return empty;
    const data = { ...empty, ...(await res.json()) } as LandmarksData;
    const crossingEdits = await loadCrossingEdits();
    return { ...data, crossings: applyCrossingEdits(data.crossings, crossingEdits.edits) };
  } catch {
    return empty;
  }
}

/** Load the hand-tuned station position overrides; tolerates a missing file. */
export async function loadStationEdits(): Promise<StationEditSet> {
  try {
    const res = await fetch("/data/stationEdits.json");
    if (!res.ok) return { edits: [] };
    return (await res.json()) as StationEditSet;
  } catch {
    return { edits: [] };
  }
}

/** Load the hand-tuned crossing position overrides; tolerates a missing file. */
export async function loadCrossingEdits(): Promise<CrossingEditSet> {
  try {
    const res = await fetch("/data/crossingEdits.json");
    if (!res.ok) return { edits: [] };
    return (await res.json()) as CrossingEditSet;
  } catch {
    return { edits: [] };
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** Center of the network's bounding box, in world meters. */
export function bboxCenter(meta: Meta): { x: number; z: number } {
  return {
    x: (meta.bbox.minX + meta.bbox.maxX) / 2,
    z: (meta.bbox.minZ + meta.bbox.maxZ) / 2,
  };
}
