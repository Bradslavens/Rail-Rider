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
}

export interface LandmarkPoint {
  x: number;
  z: number;
  name?: string;
}

export interface LandmarksData {
  buildings: Building[];
  roads: Road[];
  crossings: LandmarkPoint[];
  stations: LandmarkPoint[];
}
