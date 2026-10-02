# Contributing to Hollowmere

Thanks for wanting to haunt the place. Small, focused pull requests are easiest to take; for anything bigger (a new creature, a new interior, a new effect), open an issue first so we can agree on where it fits. The design is in [docs/design.md](docs/design.md), and the README says where everything lives.

## Getting going

You need Node 24, and Google Chrome for the checks.

```bash
npm install
npm run dev
```

The dev build has the tools: `` ` `` for the stats overlay, `V` for a free camera, `L` for the look panel, `R` for the route editor (the README's Dev tools section lists the rest). Much of the world is data in `data/`, and the editors save straight back to those files.

## Before a pull request

```bash
npm run typecheck
npm run validate -- --strict
npm run a11y
```

`validate` checks every geometry and data file and the draw-call and triangle budgets; `a11y` checks keyboard use, the live region, reduced motion, the HUD's contrast and flashing. If you touched loading or the assets, also run `npm run loadtime` (under 3 s and 5 MB to the first frame). If you changed how something looks, include a screenshot (`npm run shots`) in the pull request.

## House rules

- **Original work only.** Castles, dragons, bats, pumpkins, ghosts, gargoyles and spiders are shared Halloween vocabulary and welcome. Characters, creatures, symbols and places from anyone's franchise are not (design doc §3).
- **No runtime calls.** The site makes no API requests: no analytics, no trackers, no AI calls. Generated art is a build step (`npm run generate`), and the processed files are what ship.
- **Nothing flashes faster than 3 Hz.** Flicker, fire and sky events stay under it; `npm run a11y` measures it.
- **Respect reduced motion.** New motion that isn't the point (bobbing, drifting, shake) stops under `prefers-reduced-motion`; use `reduceMotion` from the life context.
- **Data over code.** Positions, timings and looks belong in `data/*.json`, so they can be tuned without reading the code.
- **Stay in budget.** 300 draw calls and 1.5M triangles on the high tier, and about 60 MB streamed on desktop, 30 MB on mobile.
- **Write like the code around it.** TypeScript strict, small modules, comments that say why.

## Licensing your contribution

By contributing you agree that what you contribute, code and art alike, comes under the [MIT License](LICENSE), the same as the rest. Only contribute what you made yourself or are free to license that way, and say in the pull request if any of it was made with a generative model.
