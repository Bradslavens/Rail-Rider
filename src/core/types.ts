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
