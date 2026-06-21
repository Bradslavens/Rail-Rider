// Minimal RFC-4180-ish CSV parsing for GTFS files.
// GTFS fields can be double-quoted with embedded commas (e.g. stop names),
// so a naive split(",") is not safe.

/** Parse a single CSV line into fields, honoring double-quoted fields. */
export function parseCsvLine(rawLine: string): string[] {
  const line = rawLine.replace(/\r$/, "");
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

/** Map a header row to column-name -> index for safe field lookup. */
export function headerIndex(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((name, i) => {
    idx[name.trim()] = i;
  });
  return idx;
}
