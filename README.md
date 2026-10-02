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
| `npm run shots -- <url> <outDir> [--mockup[=url]] [--views] [--clean]` | Screenshots of six fixed route points in headless Chrome; with `--mockup`, the same points from the mockup for side-by-side checks. With `--views` (dev server only), seven fixed free-camera views of the castle instead, steadier for judging materials and geometry. `--clean` hides the HUD |
| `npm run compare -- <reference> <screenshot> [out.png]` | A screenshot beside a reference painting, each over its palette, plus the numbers the look targets talk about; see [The look](#the-look) |
| `npm run process [-- <id>...] [--force]` | Builds the textures the app ships (`public/assets/`) from `prompts/*.yaml`; see [Textures](#textures) |
| `npm run generate -- <id> [--n=4] [--dry-run]` | Asks OpenAI's image API for texture candidates (needs `OPENAI_API_KEY`; billed to that key) |

The headless tools use the installed Google Chrome; set `CHROME` to its path if it lives elsewhere, and `ANGLE` to pick the GPU backend (`metal` on macOS by default, `swiftshader` elsewhere).

URL parameters: `?at=hall` (or `lake`, `viaduct`, `gate`, `keep`) starts at a named route point, `?autofly=0` starts in free flight, `?stats` shows the stats overlay (also in production builds, for checking performance on phones).

## Dev tools

In `npm run dev` only:

| Key | What it does |
|---|---|
| `` ` `` | Stats overlay: fps, CPU and GPU frame time, draw calls and triangles against the budgets (300 and 1.5M), memory, resolution, where the ghost is and what autofly is doing |
| `V` | Free camera. Same keys and drag as flying; the wheel sets its speed, Shift is 5×. The ghost keeps flying on its own. The camera's pose survives reloads, so it stays put while you edit code |
| `L` | Look panel: sliders and colour pickers for everything in `data/look.json`, applied live; `⌘S` saves back to the file |
| `R` | Route editor (opens the free camera). Click a handle to select it, drag the gizmo to move it, edit speed, names and pass-through legs in the panel. `[` `]` step through waypoints, `I` inserts, `Delete` removes, `J` flies the route from the selected point, `⌘Z` / `⇧⌘Z` undo and redo, `⌘S` saves to `data/route.json` without reloading |
| `T` / `.` | Pause the world / step one frame |
| `G` | Drop the ghost in front of the free camera and fly it from there |
| `K` | Re-run every check and print the results to the console |

The route line is coloured by speed. It turns red where it dips under the ghost's 1.8 m ground clearance (the ghost would float up off the route) and violet where it passes through stone on a leg that isn't listed in `through`.

The route check also makes sure autofly enters and leaves the great hall through its windows rather than the stone between them, since flying in through the glass is the signature moment.

Geometry checks run before the first frame and then every half second over whatever changed: NaN or Infinity in any attribute, instance matrix, transform or uniform; zero-length normals on lit meshes (normalising zero gives NaN on the GPU); indices past the end; attributes shorter than the positions. Problems go to the console, and a red badge appears top right while the overlay is closed.

## The look

How the world looks lives in `data/look.json`, apart from where things are: the grade (exposure, contrast, split tone, the lifted black, vignette, grain), bloom, the emissive levels, moonlight, the hemisphere and the cold fill from the far side, the sky's colours, fog, the lake and the mist. Tune it in a dev build with the look panel (`L`) while looking at the result, and save from there. The emissive levels and bloom were tuned together: change them only while looking (design doc §8).

The scene draws in two goes (`src/render/post.ts`): everything that writes depth, then, with that depth in a texture, the see-through things. That lets the mist fade softly wherever it meets water, rock or wall, so a bank can sit right on the lake. The lake is a planar reflection bent by scrolling ripple normals, with fresnel and the moon's glitter path.

The mood-board paintings (design doc §3a) are references only and stay out of the repo. Put them in `reference/`, which is gitignored, and check a view against one:

```bash
npm run shots -- http://localhost:5173 shots --clean
npm run compare -- reference/painting-a.png shots/lake-port.png
```

It writes `shots/lake-port-compare.png` and prints, for both images, the brightness spread, how much is near black, how much is warm light, and the colour of the sky, the shadows and the highlights. Take a quality, never a composition: compare palette and light, not layout.

## Textures

The castle's surfaces come from a small texture library: castle stone, the tower window atlas (with its emissive map), roof slate, flagstones and the hall's stained glass. Each has a spec in `prompts/<id>.yaml` holding the image prompt, the tile size in metres, which maps to build at which size per tier, and its `source`.

```
prompts/<id>.yaml ─ npm run generate ─▶ assets/raw/<id>/<candidate>.png   (gitignored)
                                          │  pick one: source: <candidate>
                  ─ npm run process  ───▶ public/assets/tex/*.ktx2 + manifest.json   (committed)
```

- **Stand-ins.** Every texture has `source: synth` for now: a procedural stand-in from `tools/tex/` (masonry, slate, windows, glass), built deterministically from the `synth:` parameters. `npm run process` writes a viewable copy to `assets/raw/<id>/synth*.png`.
- **Generated.** `npm run generate -- stone` asks the image model for candidates, makes tileable ones seamless (shift by half a tile, inpaint the seam cross, check), and records each candidate's prompt and model beside it. Set `source:` to the one you want and run `npm run process`. Relief and, for the window atlas, glow are then derived from the image. The key comes from `OPENAI_API_KEY` in your shell and never goes in the repo or the app; `--dry-run` shows the request without sending it.
- **Processing.** Albedo is encoded as ETC1S, normal and emissive maps as UASTC with zstd, all with mipmaps, at a desktop and a mobile size. Assets whose spec, source and code haven't changed are skipped, so the first run takes a few minutes and later ones only redo what changed. The processed files are the source of truth: generated images can't be reproduced bit for bit.
- **In the app.** `src/world/assets.ts` loads the manifest and the KTX2 files for the tier (mobile on touch screens for now). The kit's UVs are in metres and each texture repeats over its own `tile`, so courses of stone are the same size on every wall.

## Where things live

- `data/world.json`: landmark positions and sizes, warm lights, mist banks, and where creatures live
- `data/look.json`: grade, bloom, emissive levels, moon and fill light, sky, fog, water and mist
- `data/route.json`: the autofly loop and its named points
- `data/zones.json`: audio zones and the place names the HUD shows
- `src/world/`: terrain, rock columns, sky, water, mist, trees, lights, and the texture library loader
- `src/world/kit/`: the castle kit (towers, curtain walls, the great hall, the viaduct, the gate, the boathouse), assembled from `data/world.json` by `src/world/castle.ts`
- `src/flight/`: the ghost, flight model, camera and autofly
- `src/life/`: pumpkins, candles, ghosts, bats, the wyrm, the lake's wisps and boat
- `src/audio/`: synthesized music and ambience, driven by the zones
- `src/render/`: the two-pass scene render, bloom and grade, and the look data's live hooks
- `src/ui/`: HUD, controls, touch input
- `src/dev/`: stats overlay, free camera, route editor, look panel, geometry and data checks (left out of production builds, except the overlay behind `?stats`)
- `prompts/`: one spec per texture, plus the style guide prepended to every prompt
- `public/assets/`: the processed textures and their manifest
- `tools/`: texture generation and processing (`tools/tex/` has the stand-in generators and the encoder), headless Chrome screenshots, validation and the reference comparison, and the dev-server endpoint the route editor and look panel save through

No analytics, no cookies, no network calls after load. The one local-storage key is the sound preference (dev builds also remember whether the stats overlay is open).
