import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  round1,
  parseSignalNames,
  importSignals,
  applyStationEdits,
  upsertStationEdit,
  applyCrossingEdits,
  matchCrossingIndex,
  originalCrossings,
  upsertCrossingEdit,
} from "../src/edit/adminEdits.ts";
import type {
  Signal,
  Track,
  LandmarkPoint,
  StationEdit,
  CrossingEdit,
} from "../src/core/types.ts";

// The real MTS Blue Line signal list the admin will import (from the line
// schematic), and the real Blue North track from the committed pipeline out.
const BLUE_NAMES = ["S154","S16RA","S16LB","S226","S287","S296","S356","S406","S24","S24LB","S32R","S32LB","S592","S633","S662","S40R","S40LB","S816","S819","S44AA","S44LB","S916","S984","S54AA","S54LB","S1172","S1175","S58RA","S58LB","S1332","S1333","S62RA","S62LB","S1472","S98RA","S98LB"];

const tracks: Track[] = JSON.parse(
  readFileSync(new URL("../pipeline/out/tracks.json", import.meta.url), "utf8"),
);
const blue = tracks.find((t) => t.shortName === "Blue" && t.directionName === "North")!;

const sig = (over: Partial<Signal> = {}): Signal => ({
  id: "s1",
  name: "E1",
  shapeId: "shapeA",
  distM: 10,
  side: "R",
  aspect: "green",
  ...over,
});

describe("parseSignalNames", () => {
  it("parses a JSON array (the pasted Blue Line list)", () => {
    expect(parseSignalNames(JSON.stringify(BLUE_NAMES))).toEqual(BLUE_NAMES);
  });

  it("parses newline-separated names (one CSV column)", () => {
    expect(parseSignalNames("S154\nS16RA\r\nS16LB\n")).toEqual(["S154", "S16RA", "S16LB"]);
  });

  it("parses comma-separated names with quotes and stray spaces", () => {
    expect(parseSignalNames(' "S154", \'S16RA\' ,S16LB, ')).toEqual(["S154", "S16RA", "S16LB"]);
  });

  it("parses semicolon/tab-delimited CSV cell contents", () => {
    expect(parseSignalNames("S154;S16RA\tS16LB")).toEqual(["S154", "S16RA", "S16LB"]);
  });

  it("returns empty for blank input and drops empty entries", () => {
    expect(parseSignalNames("  \n ")).toEqual([]);
    expect(parseSignalNames("S154,,S226")).toEqual(["S154", "S226"]);
  });

  it("falls back to delimiter parsing for malformed JSON", () => {
    expect(parseSignalNames("[oops\nS154")).toEqual(["[oops", "S154"]);
  });
});

describe("importSignals", () => {
  it("imports the Blue Line list evenly spaced along the real track", () => {
    const { list, added, skipped } = importSignals([], BLUE_NAMES, blue.shapeId, blue.lengthM);
    expect(added).toBe(BLUE_NAMES.length);
    expect(skipped).toEqual([]);
    expect(list.map((s) => s.name)).toEqual(BLUE_NAMES);

    const spacing = blue.lengthM / (BLUE_NAMES.length + 1);
    list.forEach((s, i) => {
      expect(s.shapeId).toBe(blue.shapeId);
      expect(s.aspect).toBe("green");
      expect(s.distM).toBeCloseTo(spacing * (i + 1), 0);
      expect(s.distM).toBeGreaterThan(0);
      expect(s.distM).toBeLessThan(blue.lengthM);
    });
    // In list order along the line, with unique ids.
    for (let i = 1; i < list.length; i++) expect(list[i].distM).toBeGreaterThan(list[i - 1].distM);
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
  });

  it("never duplicates names that already exist on the line", () => {
    const existing = [sig({ id: "b1", name: "S154", shapeId: blue.shapeId })];
    const { list, added, skipped } = importSignals(existing, BLUE_NAMES, blue.shapeId, blue.lengthM);
    expect(added).toBe(BLUE_NAMES.length - 1);
    expect(skipped).toEqual(["S154"]);
    expect(list.filter((s) => s.name === "S154")).toHaveLength(1);
  });

  it("re-importing the same list adds nothing", () => {
    const first = importSignals([], BLUE_NAMES, blue.shapeId, blue.lengthM);
    const again = importSignals(first.list, BLUE_NAMES, blue.shapeId, blue.lengthM);
    expect(again.added).toBe(0);
    expect(again.skipped).toEqual(BLUE_NAMES);
    expect(again.list).toHaveLength(BLUE_NAMES.length);
  });

  it("dedupes repeats within the pasted list itself", () => {
    const { added } = importSignals([], ["A", "A", "B"], "shapeA", 1000);
    expect(added).toBe(2);
  });

  it("ignores same-named signals on other lines", () => {
    const other = [sig({ name: "S154", shapeId: "otherShape" })];
    const { added } = importSignals(other, ["S154"], blue.shapeId, blue.lengthM);
    expect(added).toBe(1);
  });
});

describe("applyStationEdits", () => {
  const track = (shapeId: string): Track => ({
    routeId: "510",
    shortName: "Blue",
    longName: "",
    colorHex: "#0076bf",
    directionId: "0",
    directionName: "North",
    shapeId,
    lengthM: 1000,
    points: [],
    stations: [
      { stationId: "st1", name: "America Plaza", distAlong: 100 },
      { stationId: "st2", name: "Santa Fe Depot", distAlong: 400 },
    ],
  });

  it("overrides matching stations and leaves everything else untouched", () => {
    const tracks = [track("shapeA"), track("shapeB")];
    const edits: StationEdit[] = [{ shapeId: "shapeA", stationId: "st2", distAlong: 456.7 }];
    const out = applyStationEdits(tracks, edits);
    expect(out[0].stations[1].distAlong).toBe(456.7);
    expect(out[0].stations[0].distAlong).toBe(100);
    expect(out[1].stations[1].distAlong).toBe(400); // same id, other shape
    expect(tracks[0].stations[1].distAlong).toBe(400); // input not mutated
  });

  it("ignores stale edits and returns the input when there are none", () => {
    const tracks = [track("shapeA")];
    expect(applyStationEdits(tracks, [])).toBe(tracks);
    const out = applyStationEdits(tracks, [{ shapeId: "shapeA", stationId: "gone", distAlong: 1 }]);
    expect(out[0].stations.map((s) => s.distAlong)).toEqual([100, 400]);
  });

  it("upserts one override per shape+station", () => {
    let edits: StationEdit[] = [];
    edits = upsertStationEdit(edits, { shapeId: "shapeA", stationId: "st1", distAlong: 10 });
    edits = upsertStationEdit(edits, { shapeId: "shapeA", stationId: "st1", distAlong: 20 });
    edits = upsertStationEdit(edits, { shapeId: "shapeB", stationId: "st1", distAlong: 30 });
    expect(edits).toEqual([
      { shapeId: "shapeA", stationId: "st1", distAlong: 20 },
      { shapeId: "shapeB", stationId: "st1", distAlong: 30 },
    ]);
  });
});

describe("applyCrossingEdits", () => {
  const crossings: LandmarkPoint[] = [
    { x: 14178.8, z: -8121.3 },
    { x: 13459.1, z: -9251.8 },
    { x: 13458.4, z: -9656.5 },
  ];
  const edit: CrossingEdit = { index: 1, origX: 13459.1, origZ: -9251.8, x: 13470, z: -9260 };

  it("moves the crossing at the recorded index when originals agree", () => {
    const out = applyCrossingEdits(crossings, [edit]);
    expect(out[1]).toMatchObject({ x: 13470, z: -9260 });
    expect(out[0]).toMatchObject({ x: 14178.8, z: -8121.3 });
    expect(crossings[1].x).toBe(13459.1); // input not mutated
  });

  it("falls back to rounded-coordinate matching when indices shift", () => {
    const reordered = [crossings[1], crossings[0], crossings[2]];
    const out = applyCrossingEdits(reordered, [edit]); // index 1 no longer matches
    expect(out[0]).toMatchObject({ x: 13470, z: -9260 });
    expect(out[1]).toMatchObject({ x: 14178.8, z: -8121.3 });
    expect(matchCrossingIndex(reordered, edit)).toBe(0);
  });

  it("ignores edits that match nothing", () => {
    const stale: CrossingEdit = { index: 9, origX: 1, origZ: 2, x: 3, z: 4 };
    expect(applyCrossingEdits(crossings, [stale])).toEqual(crossings);
  });

  it("originalCrossings recovers pre-edit coordinates from an applied list", () => {
    const applied = applyCrossingEdits(crossings, [edit]);
    const orig = originalCrossings(applied, [edit]);
    expect(orig).toEqual(crossings.map((c) => ({ x: c.x, z: c.z })));
  });

  it("upserts one override per original crossing", () => {
    let edits: CrossingEdit[] = [edit];
    edits = upsertCrossingEdit(edits, { ...edit, x: 13480, z: -9270 });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ x: 13480, z: -9270 });
    edits = upsertCrossingEdit(edits, { index: 0, origX: 14178.8, origZ: -8121.3, x: 1, z: 2 });
    expect(edits).toHaveLength(2);
  });
});

describe("round1", () => {
  it("rounds to the pipeline's one-decimal precision", () => {
    expect(round1(13470.04)).toBe(13470);
    expect(round1(-9259.96)).toBe(-9260);
  });
});
