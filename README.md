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
| `npm run shots -- <url> <outDir> [--mockup[=url]]` | Screenshots of six fixed route points in headless Chrome; with `--mockup`, the same points from the mockup for side-by-side checks |

URL parameters: `?at=hall` (or `lake`, `viaduct`, `gate`, `keep`) starts at a named route point, `?autofly=0` starts in free flight.

## Where things live

- `data/world.json`: landmark positions and sizes, lights, and where creatures live
- `data/route.json`: the autofly loop and its named points
- `data/zones.json`: audio zones and the place names the HUD shows
- `src/world/`: terrain, rock columns, castle, sky, water, mist, trees, lights
- `src/flight/`: the ghost, flight model, camera and autofly
- `src/life/`: pumpkins, candles, ghosts, bats, the wyrm, the lake's wisps and boat
- `src/audio/`: synthesized music and ambience, driven by the zones
- `src/render/`: post-processing (bloom, grade) and dev checks
- `src/ui/`: HUD, controls, touch input

No analytics, no cookies, no network calls after load. The one local-storage key is the sound preference.
