// Shapes of the JSON the pipeline emits (see pipeline/src/gtfsToTracks.ts).

export interface TrackPoint {
  x: number;
  z: number;
  dist: number;
}

export interface TrackStation {
  stationId: string;
  name: string;
  distAlong: number;
}

export interface Track {
  routeId: string;
  shortName: string;
  longName: string;
  colorHex: string;
  directionId: string;
  directionName: string;
  shapeId: string;
  lengthM: number;
  points: TrackPoint[];
  stations: TrackStation[];
}

export interface Station {
  id: string;
  name: string;
  x: number;
  z: number;
  routeIds: string[];
}

export interface Bbox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Meta {
  source: string;
  sourceUrl: string;
  feedVersion: string;
  fetchedAt: string;
  origin: { lat: number; lon: number };
  earthRadiusM: number;
  resampleSpacingM: number;
  bbox: Bbox;
  routeCount: number;
  trackCount: number;
  stationCount: number;
  totalTrackKm: number;
}

export interface NetworkData {
  tracks: Track[];
  stations: Station[];
  meta: Meta;
}

// --- Signals (Phase 5 foundation) ----------------------------------------

export type SignalAspect = "red" | "yellow" | "green";
export type SignalSide = "L" | "R";

/** A wayside signal anchored to a track shape at an arc-length position. */
export interface Signal {
  id: string;
  name: string;
  shapeId: string;
  distM: number;
  side: SignalSide;
  aspect: SignalAspect;
}

export interface SignalSet {
  note?: string;
  signals: Signal[];
}

/** A signal resolved to a world position + facing (computed at load). */
export interface PlacedSignal extends Signal {
  x: number;
  z: number;
  /** Yaw (radians) so the head faces the approaching (forward) train. */
  headingRad: number;
}

// --- Admin editor overrides -----------------------------------------------
// Hand-tuned corrections layered over pipeline output at load time, so the
// generated files (tracks.json / landmarks.json) stay untouched.

/** Moves one GTFS station along its shape (new arc-length in meters). */
export interface StationEdit {
  shapeId: string;
  stationId: string;
  distAlong: number;
}

export interface StationEditSet {
  note?: string;
  edits: StationEdit[];
}

/**
 * Moves one OSM level crossing to a new world position. The original crossing
 * is identified by its index in landmarks.json plus its original coordinates
 * (so a regenerated file with shuffled order still matches by position).
 */
export interface CrossingEdit {
  index: number;
  origX: number;
  origZ: number;
  x: number;
  z: number;
}

export interface CrossingEditSet {
  note?: string;
  edits: CrossingEdit[];
}

// --- Landmarks (OSM, item 3) ---------------------------------------------

/** [x, z] in world meters. */
export type Pt2 = [number, number];

export interface Building {
  /** Height in meters. */
  h: number;
  /** Footprint ring (outer), world meters. */
  p: Pt2[];
}

export interface Road {
  /** Carriageway width in meters. */
  w: number;
  /** Centreline polyline, world meters. */
  p: Pt2[];
  /** OSM highway class (e.g. "primary", "residential"). */
  c?: string;
  /** Street name, when OSM has one. */
  n?: string;
}

export interface LandmarkPoint {
  x: number;
  z: number;
  name?: string;
}

/** A green area (park/grass/wooded), used for ground tint and tree scatter. */
export interface Green {
  /** Category: how densely trees are scattered inside. */
  k: "wood" | "park" | "grass";
  /** Outer ring, world meters. */
  p: Pt2[];
}

export interface LandmarksData {
  buildings: Building[];
  roads: Road[];
  crossings: LandmarkPoint[];
  stations: LandmarkPoint[];
  /** Individual tree positions (world meters). Optional (older data lacks it). */
  trees?: Pt2[];
  /** Green-area polygons. Optional (older data lacks it). */
  greens?: Green[];
}
