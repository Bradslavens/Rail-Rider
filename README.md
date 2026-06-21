# Rail Rider

A browser-based 3D driving simulator of the San Diego MTS Trolley, built on real
track geometry from official GTFS data. The goal is operator **training** — a
flight-simulator-style tool for practicing line knowledge, stops, and signals,
including rare or unsafe scenarios that can't be drilled on a live system.

> Track geometry is sourced from San Diego MTS / SANDAG open GTFS data.
> Attribution and license are recorded in `DATA_LICENSE.md` (added in Phase 1).

## Tech stack

- **Game:** TypeScript + [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/)
- **Pipeline:** TypeScript/Node — converts GTFS into game-ready track JSON (Phase 1)
- **Tests:** [Vitest](https://vitest.dev/) (pure logic; visuals verified in-browser)

## Project layout

```
src/        Three.js game (core math, sim, render, camera, ui, input)
pipeline/   GTFS → track JSON pipeline (added in Phase 1)
test/       Vitest specs
```

## Getting started

```bash
npm install      # install dependencies
npm run dev      # start the dev server (also on your LAN for device testing)
npm test         # run the test suite
```

Open the URL printed by `npm run dev` (default http://localhost:5173).

## Status

Built phase by phase. **Phase 0 (scaffold)** is complete: a lit grid, a
placeholder trolley, an orbit camera, a delta-timed render loop, and a green
test suite.
