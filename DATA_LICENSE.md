# Data Source & Attribution

Rail Rider's track geometry and station locations are derived from the official
**San Diego Metropolitan Transit System (MTS) / SANDAG** GTFS static feed.

- **Source:** San Diego Metropolitan Transit System (MTS)
- **Feed URL:** https://www.sdmts.com/google_transit_files/google_transit.zip
- **Feed version:** `2601 unmerged v2 merged with Generated on 20260521 @ 1307142`
- **Fetched:** 2026-06-21
- **Terms of use:** Governed by the MTS Terms & Conditions —
  https://www.sdmts.com/business-center-developers/terms-and-conditions

The MTS feed publishes scheduling data, not engineering survey data. Track
centerlines are accurate but approximate (resampled and smoothed for the sim),
and GTFS contains **no elevation, grade, tunnel, or signal data** — those are
either modeled as flat or authored separately (see the signals plan).

## Landmarks (buildings, roads, crossings, stations)

Scenery landmarks are derived from **OpenStreetMap** via the **Overpass API**,
pulled within a corridor around the rail lines.

- **Source:** © OpenStreetMap contributors
- **License:** Open Database License (**ODbL**) — https://www.openstreetmap.org/copyright
- **Tool:** Overpass API — https://overpass-api.de/
- **Regenerate:** `npm run landmarks` (optionally `-- --line Copper` for one line,
  `-- --force` to bypass the `pipeline/raw` cache).

Heights come from OSM `height` / `building:levels` tags where present, else a
low-rise default; positions are reprojected with the same origin as the tracks.

## Textures

Surface textures (asphalt, gravel/ballast, concrete, grass) under
`public/textures/` are from **ambientCG** and are **CC0 / public domain** — no
attribution is required, but credit is given here gratefully.

- **Source:** ambientCG — https://ambientcg.com/
- **License:** CC0 1.0 (public domain)
- **Sets:** Asphalt026C, Gravel022, Concrete034, Grass004 (1K JPG, color +
  normal + roughness maps).

## What is committed

- `pipeline/raw/` — the downloaded GTFS zip and extracted files. **Not committed**
  (gitignored); re-download with the pipeline to refresh.
- `pipeline/out/` — the processed, game-ready JSON (`tracks.json`,
  `stations.json`, `meta.json`). **Committed** so the game builds offline.

## Refreshing the data

```bash
# (re)download the feed into pipeline/raw, then:
npm run pipeline
```

The pipeline records the feed version and fetch date in `meta.json`. Attribution
to MTS/SANDAG will be shown in the game's About screen (Phase 6).
