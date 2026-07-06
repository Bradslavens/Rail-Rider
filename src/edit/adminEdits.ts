import type {
  Signal,
  Track,
  LandmarkPoint,
  StationEdit,
  CrossingEdit,
} from "../core/types.ts";
import { addSignal, nextSignalId } from "./signalEdits.ts";

// Pure helpers behind the admin editor's station/crossing override layers and
// the bulk signal import. Overrides live in data/stationEdits.json and
// data/crossingEdits.json and are applied over the pipeline output at load
// time, so tracks.json / landmarks.json stay pipeline-owned.

/** Round to one decimal, matching the pipeline's coordinate precision. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// --- bulk signal import ---------------------------------------------------

/**
 * Parse a pasted list of signal names. Accepts a JSON array (["S154", ...])
 * or comma/newline/semicolon/tab-separated text (i.e. CSV cell contents),
 * with optional quotes around each name. Empty entries are dropped.
 */
export function parseSignalNames(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr.map((n) => String(n).trim()).filter((n) => n.length > 0);
      }
    } catch {
      // Not valid JSON after all — fall through to delimiter parsing.
    }
  }
  return trimmed
    .split(/[,;\t\r\n]+/)
    .map((n) => n.trim().replace(/^["']+|["']+$/g, "").trim())
    .filter((n) => n.length > 0);
}

export interface ImportResult {
  /** New working list with the imported signals appended. */
  list: Signal[];
  /** How many signals were created. */
  added: number;
  /** Names skipped because they already exist on the line (or repeat). */
  skipped: string[];
}

/**
 * Create one green signal per name on the given shape, evenly spaced along
 * its length in list order (so each can then be dragged to its true spot).
 * Names already present on that shape — and repeats within the pasted list —
 * are skipped, never duplicated.
 */
export function importSignals(
  list: Signal[],
  names: string[],
  shapeId: string,
  lengthM: number,
): ImportResult {
  const seen = new Set(list.filter((s) => s.shapeId === shapeId).map((s) => s.name));
  const fresh: string[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    if (seen.has(name)) skipped.push(name);
    else {
      seen.add(name);
      fresh.push(name);
    }
  }

  // Even spacing that keeps signals off the termini: k-th of N at k/(N+1).
  const spacing = lengthM / (fresh.length + 1);
  let out = list;
  fresh.forEach((name, i) => {
    out = addSignal(out, {
      id: nextSignalId(out, shapeId),
      name,
      shapeId,
      distM: round1(spacing * (i + 1)),
      side: "R",
      aspect: "green",
    });
  });
  return { list: out, added: fresh.length, skipped };
}

// --- station overrides ----------------------------------------------------

/**
 * Apply station position overrides to the pipeline's tracks. Pure: returns
 * new track/station objects for anything touched. Edits that match no
 * station (stale ids after a GTFS refresh) are ignored.
 */
export function applyStationEdits(tracks: Track[], edits: StationEdit[]): Track[] {
  if (edits.length === 0) return tracks;
  return tracks.map((t) => {
    const forShape = edits.filter((e) => e.shapeId === t.shapeId);
    if (forShape.length === 0) return t;
    return {
      ...t,
      stations: t.stations.map((st) => {
        const e = forShape.find((e) => e.stationId === st.stationId);
        return e ? { ...st, distAlong: e.distAlong } : st;
      }),
    };
  });
}

/** Add or replace the override for one station (keyed by shape + station). */
export function upsertStationEdit(edits: StationEdit[], edit: StationEdit): StationEdit[] {
  const i = edits.findIndex(
    (e) => e.shapeId === edit.shapeId && e.stationId === edit.stationId,
  );
  return i >= 0 ? edits.map((e, j) => (j === i ? edit : e)) : [...edits, edit];
}

// --- crossing overrides ---------------------------------------------------

/** Whether a crossing's coordinates match an edit's recorded originals. */
function matchesOriginal(c: LandmarkPoint, e: CrossingEdit): boolean {
  return Math.round(c.x) === Math.round(e.origX) && Math.round(c.z) === Math.round(e.origZ);
}

/**
 * Find which crossing an edit refers to: the recorded index when its original
 * coordinates still agree, otherwise the first crossing whose (rounded)
 * coordinates match — which survives the pipeline reordering the file.
 */
export function matchCrossingIndex(crossings: LandmarkPoint[], e: CrossingEdit): number {
  if (e.index >= 0 && e.index < crossings.length && matchesOriginal(crossings[e.index], e)) {
    return e.index;
  }
  return crossings.findIndex((c) => matchesOriginal(c, e));
}

/**
 * Apply crossing position overrides to the pipeline's crossing list. Pure and
 * order-preserving: index i in the result is the same crossing as index i in
 * the input. Edits that match nothing are ignored.
 */
export function applyCrossingEdits(
  crossings: LandmarkPoint[],
  edits: CrossingEdit[],
): LandmarkPoint[] {
  if (edits.length === 0) return crossings;
  const out = crossings.map((c) => ({ ...c }));
  for (const e of edits) {
    const i = matchCrossingIndex(crossings, e);
    if (i >= 0) {
      out[i].x = e.x;
      out[i].z = e.z;
    }
  }
  return out;
}

/**
 * Recover each crossing's pre-edit coordinates from an already-applied list
 * (as loaded by the app) plus the edit set that produced it. Needed so the
 * editor can re-save edits that still match the pipeline's original file.
 * Applied crossings carry the edit's exact x/z, which identifies them.
 */
export function originalCrossings(
  applied: LandmarkPoint[],
  edits: CrossingEdit[],
): { x: number; z: number }[] {
  const orig = applied.map((c) => ({ x: c.x, z: c.z }));
  for (const e of edits) {
    const isTarget = (i: number) =>
      i >= 0 && i < applied.length && applied[i].x === e.x && applied[i].z === e.z;
    const i = isTarget(e.index) ? e.index : applied.findIndex((_, j) => isTarget(j));
    if (i >= 0) orig[i] = { x: e.origX, z: e.origZ };
  }
  return orig;
}

/** Add or replace the override for one crossing (keyed by its originals). */
export function upsertCrossingEdit(edits: CrossingEdit[], edit: CrossingEdit): CrossingEdit[] {
  const i = edits.findIndex(
    (e) =>
      Math.round(e.origX) === Math.round(edit.origX) &&
      Math.round(e.origZ) === Math.round(edit.origZ),
  );
  return i >= 0 ? edits.map((e, j) => (j === i ? edit : e)) : [...edits, edit];
}
