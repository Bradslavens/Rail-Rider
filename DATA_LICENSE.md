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
