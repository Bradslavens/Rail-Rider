import { describe, it, expect } from "vitest";
import { parseCsvLine, headerIndex } from "../pipeline/src/csv.ts";

describe("parseCsvLine", () => {
  it("splits a plain comma-separated line", () => {
    expect(parseCsvLine("510,Blue,0000FF")).toEqual(["510", "Blue", "0000FF"]);
  });

  it("keeps commas inside double-quoted fields", () => {
    expect(parseCsvLine('1,"Santee, El Cajon",0')).toEqual([
      "1",
      "Santee, El Cajon",
      "0",
    ]);
  });

  it("handles escaped quotes and a trailing carriage return", () => {
    expect(parseCsvLine('a,"he said ""hi""",b\r')).toEqual([
      "a",
      'he said "hi"',
      "b",
    ]);
  });

  it("preserves empty trailing fields", () => {
    expect(parseCsvLine("a,,c,")).toEqual(["a", "", "c", ""]);
  });
});

describe("headerIndex", () => {
  it("maps trimmed column names to their position", () => {
    expect(headerIndex(["route_id", " route_type "])).toEqual({
      route_id: 0,
      route_type: 1,
    });
  });
});
