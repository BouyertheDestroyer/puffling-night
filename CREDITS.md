# Credits

## Third-party assets

All third-party assets come from [Poly Haven](https://polyhaven.com) and are released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain): free to use, modify and
redistribute, attribution not required but given here with thanks. They were downloaded with
`tools/fetch-assets.mjs` and shrunk (meshopt geometry, WebP textures) with `tools/optimize-assets.mjs`.

| Kind | Asset | Author(s) | Licence |
| --- | --- | --- | --- |
| Model | [Cardboard Box 01](https://polyhaven.com/a/cardboard_box_01) | Rahul Chaudhary | CC0 1.0 |
| Model | [Street Lamp 01](https://polyhaven.com/a/street_lamp_01) | Josh Dean | CC0 1.0 |
| Model | [Stone Fire Pit](https://polyhaven.com/a/stone_fire_pit) | Sebastian Platen | CC0 1.0 |
| Model | [Boulder 01](https://polyhaven.com/a/boulder_01) | Rico Cilliers | CC0 1.0 |
| Model | [Metal Trash Can](https://polyhaven.com/a/metal_trash_can) | GurJas Studios | CC0 1.0 |
| Model | [Painted Wooden Bench](https://polyhaven.com/a/painted_wooden_bench) | Kirill Sannikov | CC0 1.0 |
| Model | [Lifebuoy](https://polyhaven.com/a/lifebuoy) | Hank Kaamura | CC0 1.0 |
| Model | [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) | Kless Gyzen | CC0 1.0 |
| Model | [Utility Box 01](https://polyhaven.com/a/utility_box_01) | James Ray Cock | CC0 1.0 |
| Model | [Fire Hydrant](https://polyhaven.com/a/fire_hydrant) | Gonçalo Felício | CC0 1.0 |
| Model | [Coast Rocks 01](https://polyhaven.com/a/coast_rocks_01) | Rob Tuytel, Rico Cilliers | CC0 1.0 |
| Model | [Ocean Buoy](https://polyhaven.com/a/ocean_buoy) | Mateusz Sadek | CC0 1.0 |
| Texture | [Asphalt 02](https://polyhaven.com/a/asphalt_02) | Rob Tuytel | CC0 1.0 |
| Texture | [Concrete Pavement](https://polyhaven.com/a/concrete_pavement) | Charlotte Baglioni | CC0 1.0 |
| Texture | [Corrugated Iron 02](https://polyhaven.com/a/corrugated_iron_02) | Jenelle van Heerden, Sergej Majboroda | CC0 1.0 |
| Texture | [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) | Rob Tuytel | CC0 1.0 |
| Texture | [Cliff Side](https://polyhaven.com/a/cliff_side) | James Ray Cock, Jenelle van Heerden, Dario Barresi | CC0 1.0 |
| Texture | [Coast Sand Rocks 02](https://polyhaven.com/a/coast_sand_rocks_02) | Rob Tuytel | CC0 1.0 |
| Texture | [White Plaster Rough 01](https://polyhaven.com/a/white_plaster_rough_01) | Rob Tuytel | CC0 1.0 |
| Texture | [Wood Planks Grey](https://polyhaven.com/a/wood_planks_grey) | Rob Tuytel | CC0 1.0 |
| Texture | [Dark Rock](https://polyhaven.com/a/dark_rock) | Amal Kumar | CC0 1.0 |
| Texture | [Gravel Road](https://polyhaven.com/a/gravel_road) | Amal Kumar | CC0 1.0 |
| HDRI | [Rogland Clear Night](https://polyhaven.com/a/rogland_clear_night) | Greg Zaal | CC0 1.0 |

## Made for this game

Everything else was made for Puffling Night and is part of this repository:

- The town, terrain, roads, houses, church, harbour, lighthouse and cliff lookout (generated in code).
- The car, the player character, the caveman, the pufflings and the cardboard box (modelled in code).
- The sky: stars, moon, Milky Way and aurora (shaders), and the sea (shader, generated wave normals).
- All animation (procedural), all sound and music (synthesised live with WebAudio), the interface.

## Libraries

- [three.js](https://threejs.org) (MIT licence), including its post-processing, GLTF and meshopt loaders.
