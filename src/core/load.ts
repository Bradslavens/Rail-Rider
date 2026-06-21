import type { NetworkData, Track, Station, Meta, SignalSet, LandmarksData } from "./types.ts";

// Load the processed network JSON served from /data (synced from pipeline/out).
export async function loadNetwork(): Promise<NetworkData> {
  const [tracks, stations, meta] = await Promise.all([
    fetchJson<Track[]>("/data/tracks.json"),
    fetchJson<Station[]>("/data/stations.json"),
    fetchJson<Meta>("/data/meta.json"),
  ]);
  return { tracks, stations, meta };
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

/** Load OSM landmarks (buildings/roads/crossings/stations); tolerant. */
export async function loadLandmarks(): Promise<LandmarksData> {
  const empty: LandmarksData = { buildings: [], roads: [], crossings: [], stations: [] };
  try {
    const res = await fetch("/data/landmarks.json");
    if (!res.ok) return empty;
    return { ...empty, ...(await res.json()) } as LandmarksData;
  } catch {
    return empty;
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
