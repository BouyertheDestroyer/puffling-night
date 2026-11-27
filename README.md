# Puffling Night

A night-time open-world game in the browser about rescuing pufflings, the young puffins that leave
their burrows in late summer and, confused by the lights of town, end up stranded in the streets.
Drive around a procedurally generated Icelandic harbour town, get out, catch the pufflings in a
cardboard box, drive them up to the cliffs and throw them out over the sea so they fly the right way.
The more you save, the more stars you earn.

The town is alive. People walk the pavements, and some of them are out rescuing pufflings of their
own, so you can sneak up behind them and pinch theirs. Other drivers are on the roads, and you can
pull them out and take their cars. The draugar, the restless dead of Icelandic stories, wander the
edges of town. Cars are proper rigid bodies that roll, tumble and go off cliffs, and you can jump,
fall, swim and fight. Hitting a puffling lands you in the police cells. It's a jungle out there.

Play it at **https://bouyerthedestroyer.github.io/puffling-night/**.

## Controls

| On foot | |
| --- | --- |
| W A S D / arrows | move |
| Mouse | look (click the game to capture the mouse) |
| Shift / Space / C | run / jump / sneak |
| E | catch a puffling, take or put a box, pinch someone's pufflings, throw from the lookout |
| G | put the box down |
| Left click / R | punch (R swims ashore when you're in the sea) |
| Q | fists or the fishing knife (it's on the pier) |
| F | get in a car, or take someone else's |

| Driving | |
| --- | --- |
| W / S | accelerate, brake and reverse |
| A / D | steer |
| Space | handbrake |
| Q / L | horn / headlights |
| R | put an overturned car back on its wheels |
| F | get out (at speed you jump out) |

M opens the map and H the help. A gamepad works too. On a touch screen, the left thumb moves or
drives, dragging on the right looks around, and on-screen buttons do E, the car, jumping or braking,
punching, running and the map.

People speak through the browser's speech synthesis, which uses the voices installed on the
computer; with a British English voice installed they sound British.

## Development

```
npm install
npm run dev        # http://localhost:5199
npm run build      # -> dist/
node tests/play.mjs <outdir>   # plays the whole loop in Firefox (Playwright) and takes screenshots
node tests/features.mjs <outdir> # jumping, falls, swimming, cliffs, fights, pickpocketing, carjacking, draugar, jail
node tests/flow.mjs <outdir>   # title screen -> intro -> game
node tests/soak.mjs            # 90 s of random play: errors, frame rate, object counts
```

Built with [three.js](https://threejs.org) and Vite. The world is generated from a fixed seed in
`src/world/layout.js`. Assets are fetched from Poly Haven by `tools/fetch-assets.mjs` and optimised by
`tools/optimize-assets.mjs`; the optimised copies live in `public/assets/`. See `CREDITS.md`.

Pushing to `main` deploys to GitHub Pages.
