# Hollowmere

You are a ghost drifting through a haunted castle on a cliff above a moonlit lake. It opens on autofly; take over at any time, fly through walls, and let go to drift back onto the lantern route.

The design is in [docs/design.md](docs/design.md). The original single-file block-out is in [docs/mockup/](docs/mockup/hollowmere-mockup.html) and is the visual reference for milestone M0.

## Running it

```bash
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then a static build in `dist/` (relative paths, deployable anywhere) |
| `npm run typecheck` | `tsc` over `src/` and `tools/` |
| `npm run validate [-- <devUrl>] [--strict]` | Checks the data files and every geometry in headless Chrome, then flies the route and measures draw calls and triangles against the budgets. Starts its own dev server unless given a URL. Exits 1 on errors; `--strict` also fails on warnings and budget overruns |
| `npm run shots -- <url> <outDir> [--mockup[=url]]` | Screenshots of six fixed route points in headless Chrome; with `--mockup`, the same points from the mockup for side-by-side checks |

The headless tools use the installed Google Chrome; set `CHROME` to its path if it lives elsewhere, and `ANGLE` to pick the GPU backend (`metal` on macOS by default, `swiftshader` elsewhere).

URL parameters: `?at=hall` (or `lake`, `viaduct`, `gate`, `keep`) starts at a named route point, `?autofly=0` starts in free flight, `?stats` shows the stats overlay (also in production builds, for checking performance on phones).

## Dev tools

In `npm run dev` only:

| Key | What it does |
|---|---|
| `` ` `` | Stats overlay: fps, CPU and GPU frame time, draw calls and triangles against the budgets (300 and 1.5M), memory, resolution, where the ghost is and what autofly is doing |
| `V` | Free camera. Same keys and drag as flying; the wheel sets its speed, Shift is 5×. The ghost keeps flying on its own. The camera's pose survives reloads, so it stays put while you edit code |
| `R` | Route editor (opens the free camera). Click a handle to select it, drag the gizmo to move it, edit speed, names and pass-through legs in the panel. `[` `]` step through waypoints, `I` inserts, `Delete` removes, `J` flies the route from the selected point, `⌘Z` / `⇧⌘Z` undo and redo, `⌘S` saves to `data/route.json` without reloading |
| `T` / `.` | Pause the world / step one frame |
| `G` | Drop the ghost in front of the free camera and fly it from there |
| `K` | Re-run every check and print the results to the console |

The route line is coloured by speed. It turns red where it dips under the ghost's 1.8 m ground clearance (the ghost would float up off the route) and violet where it passes through stone on a leg that isn't listed in `through`.

Geometry checks run before the first frame and then every half second over whatever changed: NaN or Infinity in any attribute, instance matrix, transform or uniform; zero-length normals on lit meshes (normalising zero gives NaN on the GPU); indices past the end; attributes shorter than the positions. Problems go to the console, and a red badge appears top right while the overlay is closed.

## Where things live

- `data/world.json`: landmark positions and sizes, lights, and where creatures live
- `data/route.json`: the autofly loop and its named points
- `data/zones.json`: audio zones and the place names the HUD shows
- `src/world/`: terrain, rock columns, castle, sky, water, mist, trees, lights
- `src/flight/`: the ghost, flight model, camera and autofly
- `src/life/`: pumpkins, candles, ghosts, bats, the wyrm, the lake's wisps and boat
- `src/audio/`: synthesized music and ambience, driven by the zones
- `src/render/`: post-processing (bloom, grade)
- `src/ui/`: HUD, controls, touch input
- `src/dev/`: stats overlay, free camera, route editor, geometry and data checks (left out of production builds, except the overlay behind `?stats`)
- `tools/`: headless Chrome screenshots and validation, and the dev-server endpoint the route editor saves through

No analytics, no cookies, no network calls after load. The one local-storage key is the sound preference (dev builds also remember whether the stats overlay is open).
