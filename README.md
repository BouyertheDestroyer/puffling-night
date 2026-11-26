# Puffling Night

A night-time open-world game in the browser about rescuing pufflings, the young puffins that leave
their burrows in late summer and, confused by the lights of town, end up stranded in the streets.
Drive around a procedurally generated Icelandic harbour town, get out, catch the pufflings in a
cardboard box, drive them up to the cliffs and throw them out over the sea so they fly the right way.
The more you save, the more stars you earn.

Play it at **https://bouyerthedestroyer.github.io/puffling-night/**.

## Controls

| | |
| --- | --- |
| W A S D / arrows | move, or drive |
| Mouse | look (click the game to capture the mouse) |
| Shift | run |
| C | sneak |
| E / left click | catch a puffling, take or put the box, throw from the lookout |
| F | get in or out of the car |
| Space | handbrake |
| Q / L | horn / headlights |
| M | map |
| H | help |

A gamepad works too.

## Development

```
npm install
npm run dev        # http://localhost:5199
npm run build      # -> dist/
node tests/play.mjs <outdir>   # plays the whole loop in Firefox (Playwright) and takes screenshots
```

Built with [three.js](https://threejs.org) and Vite. The world is generated from a fixed seed in
`src/world/layout.js`. Assets are fetched from Poly Haven by `tools/fetch-assets.mjs` and optimised by
`tools/optimize-assets.mjs`; the optimised copies live in `public/assets/`. See `CREDITS.md`.

Pushing to `main` deploys to GitHub Pages.
